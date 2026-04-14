import "server-only";

import { CustomersFirstClient } from "@/lib/c1st/client";
import type { NormalizedTicketMaterial } from "@/lib/c1st/normalize-ticket-material";
import { createAdminClient } from "@/lib/supabase/server";
import { getServerConfig } from "@/lib/env";
import { getDailyTargetHoursForDate } from "@/lib/targets";
import { getCopenhagenDateString, toIsoTimestamp } from "@/lib/time";

const SCHEDULED_SYNC_LOCK_MINUTES = 20;
const SYNC_CURSOR_OVERLAP_MINUTES = 2;
const DEFAULT_PAYMENT_BACKFILL_DAYS = 7;
const SUCCESSFUL_SYNC_STATUSES = ["completed", "completed_with_warning"] as const;

type MechanicMapping = {
  id: string;
  mechanic_name: string;
  mechanic_item_no: string;
  display_order: number;
  active: boolean;
};

type DailyBaselineRow = {
  stat_date: string;
  ticket_id: number;
  mechanic_item_no: string;
  mechanic_id: string;
  baseline_quantity: number;
  current_quantity: number;
  source_payment_id: number | null;
  source_amountpaid: number | null;
  source_updated_at: string | null;
  ticket_material_id: number;
  ticket_type?: string | null;
  last_seen_at: string | null;
};

export type SyncMode = "baseline" | "sync" | "payments_backfill";
type MaterialSyncLogType = Extract<SyncMode, "baseline" | "sync">;
type SyncLogType = SyncMode | "scheduled";

export type PaymentSyncMetrics = {
  httpCalls: number;
  paymentsSeen: number;
  paymentsUpserted: number;
  paymentUpdatedAfter: string;
  paymentBackfillWindowDays: number | null;
  paymentError: string | null;
  ticketLookupCount: number;
  ticketLookupMissCount: number;
};

export type SyncResult = {
  syncLogId: string;
  mode: SyncMode;
  statDate: string;
  httpCalls: number;
  materialsSeen: number;
  mappedMaterialsSeen: number;
  rowsUpserted: number;
  rowsCorrected: number;
  anomalyCount: number;
  details: {
    unmappedProductNos: string[];
    missingProductNoCount: number;
    affectedMechanicIds: string[];
    visibilityAnomalies: number[];
  };
  payment: PaymentSyncMetrics | null;
};

type ScheduledMetrics = {
  httpCalls: number;
  materialsSeen: number;
  rowsUpserted: number;
  rowsCorrected: number;
  anomalyCount: number;
};

export type ScheduledSyncStartResult =
  | {
      skipped: true;
      runningSyncLogId: string;
      runningSyncType: SyncLogType;
      startedAt: string | null;
      lockWindowMinutes: number;
    }
  | {
      skipped: false;
      syncLogId: string;
      startedAt: string;
      lockWindowMinutes: number;
    };

function roundNumber(value: number): number {
  return Math.round(value * 100) / 100;
}

function minutesAgoIso(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function dateDaysAgo(daysAgo: number) {
  const date = new Date(`${getCopenhagenDateString()}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function atStartOfDay(date: string) {
  return `${date} 00:00:00`;
}

function rewindIsoTimestamp(timestamp: string, minutes: number) {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return timestamp;
  }

  parsed.setUTCMinutes(parsed.getUTCMinutes() - minutes);
  return parsed.toISOString();
}

function combineSyncMessages(current: string | null, next: string) {
  return current ? `${current}; ${next}` : next;
}

function resolveMaterialStatDate(material: NormalizedTicketMaterial, fallbackDate?: string | null) {
  return material.sourceDate ?? material.updatedAt?.slice(0, 10) ?? fallbackDate ?? null;
}

function buildBaselineAnomaly(existing: DailyBaselineRow | undefined, material: NormalizedTicketMaterial, mode: SyncMode): string | null {
  if (mode === "baseline" || !existing) {
    return null;
  }

  if (existing.source_payment_id !== null && existing.current_quantity !== material.amount) {
    return "changed_after_paid";
  }

  if (material.amount < existing.baseline_quantity) {
    return "below_baseline_correction";
  }

  if (material.amount < existing.current_quantity) {
    return "quantity_decreased";
  }

  return null;
}

async function fetchTicketScopedMaterials(ticketIds: number[]) {
  const client = new CustomersFirstClient();
  const uniqueTicketIds = [...new Set(ticketIds)];
  const materialsByTicketId = new Map<number, NormalizedTicketMaterial[]>();
  let httpCalls = 0;
  let materialsSeen = 0;

  for (const ticketId of uniqueTicketIds) {
    const response = await client.listAllTicketMaterialsForTicket(ticketId);
    materialsByTicketId.set(ticketId, response.normalizedItems);
    httpCalls += response.httpCalls;
    materialsSeen += response.normalizedItems.length;
  }

  return {
    materialsByTicketId,
    httpCalls,
    materialsSeen,
  };
}

async function fetchActiveMappings() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("mechanic_item_mapping")
    .select("id, mechanic_name, mechanic_item_no, display_order, active")
    .eq("active", true)
    .order("display_order", { ascending: true })
    .order("mechanic_name", { ascending: true });

  if (error) {
    throw new Error(`Failed to load mechanic mappings: ${error.message}`);
  }

  return (data ?? []) as MechanicMapping[];
}

async function createSyncLog(type: SyncLogType) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("sync_event_log")
    .insert({
      sync_type: type,
      status: "running",
      started_at: toIsoTimestamp(),
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create sync log: ${error?.message ?? "unknown error"}`);
  }

  return data.id as string;
}

async function completeSyncLog(syncLogId: string, patch: Record<string, unknown>) {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("sync_event_log")
    .update({
      ...patch,
      finished_at: toIsoTimestamp(),
    })
    .eq("id", syncLogId);

  if (error) {
    throw new Error(`Failed to update sync log ${syncLogId}: ${error.message}`);
  }
}

export function aggregateScheduledMetrics(results: Array<SyncResult | null>): ScheduledMetrics {
  return results.reduce<ScheduledMetrics>(
    (totals, result) => {
      if (!result) {
        return totals;
      }

      totals.httpCalls += result.httpCalls;
      totals.materialsSeen += result.materialsSeen;
      totals.rowsUpserted += result.rowsUpserted;
      totals.rowsCorrected += result.rowsCorrected;
      totals.anomalyCount += result.anomalyCount;
      return totals;
    },
    {
      httpCalls: 0,
      materialsSeen: 0,
      rowsUpserted: 0,
      rowsCorrected: 0,
      anomalyCount: 0,
    },
  );
}

export async function startScheduledSyncRun(lockWindowMinutes = SCHEDULED_SYNC_LOCK_MINUTES): Promise<ScheduledSyncStartResult> {
  const supabase = createAdminClient();
  const threshold = minutesAgoIso(lockWindowMinutes);
  const { data: runningLog, error: runningError } = await supabase
    .from("sync_event_log")
    .select("id, sync_type, started_at")
    .eq("status", "running")
    .in("sync_type", ["scheduled", "baseline", "sync", "payments_backfill"])
    .gte("started_at", threshold)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (runningError) {
    throw new Error(`Failed to inspect running sync jobs: ${runningError.message}`);
  }

  if (runningLog) {
    return {
      skipped: true,
      runningSyncLogId: runningLog.id as string,
      runningSyncType: runningLog.sync_type as SyncLogType,
      startedAt: (runningLog.started_at as string | null) ?? null,
      lockWindowMinutes,
    };
  }

  const startedAt = toIsoTimestamp();
  const { data, error } = await supabase
    .from("sync_event_log")
    .insert({
      sync_type: "scheduled",
      status: "running",
      started_at: startedAt,
      message: "scheduled sync started",
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create scheduled sync log: ${error?.message ?? "unknown error"}`);
  }

  return {
    skipped: false,
    syncLogId: data.id as string,
    startedAt,
    lockWindowMinutes,
  };
}

export async function completeScheduledSyncRun(
  syncLogId: string,
  {
    status,
    message,
    details,
    metrics,
  }: {
    status: "completed" | "failed" | "skipped";
    message: string;
    details?: Record<string, unknown>;
    metrics?: Partial<ScheduledMetrics>;
  },
) {
  await completeSyncLog(syncLogId, {
    status,
    message,
    http_calls: metrics?.httpCalls ?? 0,
    materials_seen: metrics?.materialsSeen ?? 0,
    rows_upserted: metrics?.rowsUpserted ?? 0,
    rows_corrected: metrics?.rowsCorrected ?? 0,
    anomaly_count: metrics?.anomalyCount ?? 0,
    details_json: details ?? {},
  });
}

async function loadRowsForDate(statDate: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("daily_ticket_item_baselines")
    .select(`
      stat_date,
      ticket_id,
      mechanic_item_no,
      mechanic_id,
      baseline_quantity,
      current_quantity,
      source_payment_id,
      source_amountpaid,
      source_updated_at,
      ticket_material_id,
      ticket_type,
      last_seen_at
    `)
    .eq("stat_date", statDate);

  if (error) {
    throw new Error(`Failed to load rows for ${statDate}: ${error.message}`);
  }

  return (data ?? []) as DailyBaselineRow[];
}

async function loadPreviousRowsByMaterialId(statDate: string, ticketMaterialIds: number[]) {
  if (ticketMaterialIds.length === 0) {
    return new Map<number, DailyBaselineRow>();
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("daily_ticket_item_baselines")
    .select(`
      stat_date,
      ticket_id,
      mechanic_item_no,
      mechanic_id,
      baseline_quantity,
      current_quantity,
      source_payment_id,
      source_amountpaid,
      source_updated_at,
      ticket_material_id,
      ticket_type,
      last_seen_at
    `)
    .lt("stat_date", statDate)
    .in("ticket_material_id", ticketMaterialIds)
    .order("stat_date", { ascending: false });

  if (error) {
    throw new Error(`Failed to load previous baseline rows: ${error.message}`);
  }

  const latestByMaterialId = new Map<number, DailyBaselineRow>();
  for (const row of (data ?? []) as DailyBaselineRow[]) {
    if (!latestByMaterialId.has(row.ticket_material_id)) {
      latestByMaterialId.set(row.ticket_material_id, row);
    }
  }

  return latestByMaterialId;
}

async function loadCarryForwardRows(statDate: string) {
  const previousDate = dateDaysAgo(1);
  const [todayRows, previousRows] = await Promise.all([loadRowsForDate(statDate), loadRowsForDate(previousDate)]);
  const existingToday = new Set(todayRows.map((row) => row.ticket_material_id));

  return previousRows.filter((row) => row.source_payment_id === null && !existingToday.has(row.ticket_material_id));
}

async function recalculateTotals(statDate: string) {
  const activeMappings = await fetchActiveMappings();
  if (activeMappings.length === 0) {
    return;
  }

  const supabase = createAdminClient();
  const mechanicIds = activeMappings.map((mapping) => mapping.id);
  const targetHoursForDate = await getDailyTargetHoursForDate(statDate);

  const [{ data: baselineRows, error: baselineError }] = await Promise.all([
    supabase
      .from("daily_ticket_item_baselines")
      .select("mechanic_id, today_added_quantity, today_added_hours")
      .eq("stat_date", statDate)
      .in("mechanic_id", mechanicIds),
  ]);

  if (baselineError) {
    throw new Error(`Failed to load baseline rows for totals: ${baselineError.message}`);
  }

  const totalsByMechanic = new Map<string, { quarters: number; hours: number; targetHours: number }>();

  for (const mechanicId of mechanicIds) {
    totalsByMechanic.set(mechanicId, {
      quarters: 0,
      hours: 0,
      targetHours: targetHoursForDate,
    });
  }

  for (const row of baselineRows ?? []) {
    const entry = totalsByMechanic.get(row.mechanic_id as string);
    if (!entry) {
      continue;
    }

    entry.quarters += Number(row.today_added_quantity ?? 0);
    entry.hours += Number(row.today_added_hours ?? 0);
  }

  const upserts = [...totalsByMechanic.entries()].map(([mechanicId, total]) => ({
    stat_date: statDate,
    mechanic_id: mechanicId,
    quarters_total: roundNumber(total.quarters),
    hours_total: roundNumber(total.hours),
    target_hours: total.targetHours,
    variance_hours: roundNumber(total.hours - total.targetHours),
    last_recalculated_at: toIsoTimestamp(),
    updated_at: toIsoTimestamp(),
  }));

  if (upserts.length === 0) {
    return;
  }

  const { error } = await supabase.from("daily_mechanic_totals").upsert(upserts, {
    onConflict: "stat_date,mechanic_id",
  });

  if (error) {
    throw new Error(`Failed to upsert daily mechanic totals: ${error.message}`);
  }
}

async function loadLatestBaselineTicketTypes(ticketIds: number[]) {
  if (ticketIds.length === 0) {
    return new Map<number, string>();
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("daily_ticket_item_baselines")
    .select("ticket_id, ticket_type, stat_date")
    .in("ticket_id", ticketIds)
    .order("stat_date", { ascending: false });

  if (error) {
    throw new Error(`Failed to load baseline ticket types: ${error.message}`);
  }

  const ticketTypes = new Map<number, string>();

  for (const row of (data ?? []) as Array<{ ticket_id: number; ticket_type: string | null }>) {
    if (!row.ticket_type || ticketTypes.has(row.ticket_id)) {
      continue;
    }

    ticketTypes.set(row.ticket_id, row.ticket_type);
  }

  return ticketTypes;
}

async function loadCachedTicketTypes(ticketIds: number[]) {
  if (ticketIds.length === 0) {
    return new Map<number, string>();
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("ticket_type_cache")
    .select("ticket_id, ticket_type")
    .in("ticket_id", ticketIds);

  if (error) {
    throw new Error(`Failed to load ticket type cache: ${error.message}`);
  }

  const cachedTicketTypes = new Map<number, string>();
  for (const row of (data ?? []) as Array<{ ticket_id: number; ticket_type: string | null }>) {
    if (!row.ticket_type) {
      continue;
    }

    cachedTicketTypes.set(row.ticket_id, row.ticket_type);
  }

  return cachedTicketTypes;
}

async function upsertTicketTypeCache(ticketTypes: Map<number, string>, updatedAt: string) {
  if (ticketTypes.size === 0) {
    return 0;
  }

  const supabase = createAdminClient();
  const upserts = [...ticketTypes.entries()].map(([ticketId, ticketType]) => ({
    ticket_id: ticketId,
    ticket_type: ticketType,
    updated_at: updatedAt,
  }));

  const { error } = await supabase.from("ticket_type_cache").upsert(upserts, {
    onConflict: "ticket_id",
  });

  if (error) {
    throw new Error(`Failed to upsert ticket_type_cache: ${error.message}`);
  }

  return upserts.length;
}

async function hasAnyPaymentSummaryRows() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("daily_payment_summary")
    .select("payment_id")
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to inspect daily_payment_summary: ${error.message}`);
  }

  return Boolean(data);
}

function getPaymentBackfillWindowStart(days: number) {
  const normalizedDays = Math.max(1, Math.trunc(days));
  return atStartOfDay(dateDaysAgo(normalizedDays - 1));
}

async function resolvePaymentUpdatedAfter(mode: SyncMode, fallbackUpdatedAfter: string, paymentBackfillDays: number) {
  if (mode === "payments_backfill") {
    return {
      paymentUpdatedAfter: getPaymentBackfillWindowStart(paymentBackfillDays),
      paymentBackfillWindowDays: paymentBackfillDays,
    };
  }

  const hasPaymentSummary = await hasAnyPaymentSummaryRows();
  if (!hasPaymentSummary) {
    return {
      paymentUpdatedAfter: getPaymentBackfillWindowStart(paymentBackfillDays),
      paymentBackfillWindowDays: paymentBackfillDays,
    };
  }

  return {
    paymentUpdatedAfter: fallbackUpdatedAfter,
    paymentBackfillWindowDays: null,
  };
}

async function syncPayments({
  client,
  paymentUpdatedAfter,
  paymentBackfillWindowDays,
  ticketTypeByTicketId,
  mappingByItemNo,
  now,
  statDate,
}: {
  client: CustomersFirstClient;
  paymentUpdatedAfter: string;
  paymentBackfillWindowDays: number | null;
  ticketTypeByTicketId: Map<number, string>;
  mappingByItemNo: Map<string, MechanicMapping>;
  now: string;
  statDate: string;
}): Promise<PaymentSyncMetrics> {
  const updatedPayments = await client.listAllUpdatedPayments(paymentUpdatedAfter);
  const allTaskIds = [...new Set(updatedPayments.normalizedItems.flatMap((payment) => payment.taskIds))];
  const [cachedTicketTypes, baselineTicketTypes] = await Promise.all([
    loadCachedTicketTypes(allTaskIds),
    loadLatestBaselineTicketTypes(allTaskIds),
  ]);

  const resolvedTicketTypes = new Map<number, string>();
  for (const [ticketId, ticketType] of ticketTypeByTicketId.entries()) {
    resolvedTicketTypes.set(ticketId, ticketType);
  }

  for (const [ticketId, ticketType] of cachedTicketTypes.entries()) {
    if (!resolvedTicketTypes.has(ticketId)) {
      resolvedTicketTypes.set(ticketId, ticketType);
    }
  }

  for (const [ticketId, ticketType] of baselineTicketTypes.entries()) {
    if (!resolvedTicketTypes.has(ticketId)) {
      resolvedTicketTypes.set(ticketId, ticketType);
    }
  }

  const missingTaskIds = allTaskIds.filter((ticketId) => !resolvedTicketTypes.has(ticketId));
  const lookedUpTicketTypes = new Map<number, string>();
  let ticketLookupMissCount = 0;

  for (const ticketId of missingTaskIds) {
    const ticket = await client.getTicketById(ticketId);
    const ticketType = ticket?.ticketType ?? null;

    if (!ticketType) {
      ticketLookupMissCount += 1;
      continue;
    }

    resolvedTicketTypes.set(ticketId, ticketType);
    lookedUpTicketTypes.set(ticketId, ticketType);
  }

  if (lookedUpTicketTypes.size > 0) {
    await upsertTicketTypeCache(lookedUpTicketTypes, now);
  }

  const paymentUpserts = updatedPayments.normalizedItems.map((payment) => {
    const paymentDate = payment.paymentDate ?? statDate;
    let mechanicTotal = 0;
    let ticketTotal = 0;

    for (const article of payment.articles) {
      ticketTotal += article.totalInclVat;
      const productNo = article.productNo?.trim() ?? null;
      if (productNo && mappingByItemNo.has(productNo)) {
        mechanicTotal += article.totalInclVat;
      }
    }

    const isRepair = payment.taskIds.some((ticketId) => resolvedTicketTypes.get(ticketId) === "repair");

    return {
      payment_id: payment.paymentId,
      payment_date: paymentDate,
      mechanic_total_incl_vat: roundNumber(mechanicTotal),
      ticket_total_incl_vat: roundNumber(ticketTotal),
      is_repair: isRepair,
      updated_at: now,
    };
  });

  if (paymentUpserts.length > 0) {
    const supabase = createAdminClient();
    const { error } = await supabase.from("daily_payment_summary").upsert(paymentUpserts, {
      onConflict: "payment_id",
    });

    if (error) {
      throw new Error(`Failed to upsert daily_payment_summary: ${error.message}`);
    }
  }

  return {
    httpCalls: updatedPayments.httpCalls + missingTaskIds.length,
    paymentsSeen: updatedPayments.normalizedItems.length,
    paymentsUpserted: paymentUpserts.length,
    paymentUpdatedAfter,
    paymentBackfillWindowDays,
    paymentError: null,
    ticketLookupCount: missingTaskIds.length,
    ticketLookupMissCount,
  };
}

async function getLastSuccessfulSyncTimestamp() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("sync_event_log")
    .select("finished_at")
    .eq("sync_type", "sync")
    .in("status", [...SUCCESSFUL_SYNC_STATUSES])
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load last successful sync timestamp: ${error.message}`);
  }

  const finishedAt = (data?.finished_at as string | undefined) ?? atStartOfDay(getCopenhagenDateString());
  return rewindIsoTimestamp(finishedAt, SYNC_CURSOR_OVERLAP_MINUTES);
}

export async function probeCustomersFirstTicketMaterials() {
  const client = new CustomersFirstClient();
  const updatedAfter = atStartOfDay(getCopenhagenDateString());
  const ticketsPage = await client.listTicketsPage({ paginationStart: 0, paginationPageLength: 5, updatedAfter });
  const sampleTicket = ticketsPage.normalizedItems[0] ?? null;
  const materialsPage = sampleTicket
    ? await client.listTicketMaterialsPage({ paginationStart: 0, paginationPageLength: 5, ticketId: sampleTicket.ticketId })
    : null;

  return {
    strategy: "tickets.updated_after -> ticket materials by ticketid -> filter on mechanic item numbers",
    updatedAfter,
    ticketProbe: {
      rawItemCount: ticketsPage.rawItems.length,
      normalizedItemCount: ticketsPage.normalizedItems.length,
      nextStart: ticketsPage.nextStart,
      sampleRawItem: ticketsPage.rawItems[0] ?? null,
      sampleNormalizedItem: sampleTicket,
    },
    ticketMaterialsProbe: materialsPage
      ? {
          rawItemCount: materialsPage.rawItems.length,
          normalizedItemCount: materialsPage.normalizedItems.length,
          nextStart: materialsPage.nextStart,
          sampleRawItem: materialsPage.rawItems[0] ?? null,
          sampleNormalizedItem: materialsPage.normalizedItems[0] ?? null,
        }
      : null,
  };
}


export async function runPhaseOneSync(
  mode: SyncMode,
  options: { paymentBackfillDays?: number } = {},
): Promise<SyncResult> {
  const syncLogId = await createSyncLog(mode);

  try {
    const statDate = getCopenhagenDateString();
    const now = toIsoTimestamp();
    const paymentBackfillDays = Math.max(1, Math.trunc(options.paymentBackfillDays ?? DEFAULT_PAYMENT_BACKFILL_DAYS));

    if (mode === "baseline") {
      const carryForwardRows = await loadCarryForwardRows(statDate);
      const upserts = carryForwardRows.map((row) => ({
        stat_date: statDate,
        ticket_material_id: row.ticket_material_id,
        ticket_id: row.ticket_id,
        mechanic_id: row.mechanic_id,
        mechanic_item_no: row.mechanic_item_no,
        baseline_quantity: roundNumber(row.current_quantity),
        current_quantity: roundNumber(row.current_quantity),
        today_added_quantity: 0,
        today_added_hours: 0,
        source_updated_at: row.source_updated_at,
        source_payment_id: row.source_payment_id,
        source_amountpaid: row.source_amountpaid,
        ticket_type: row.ticket_type ?? null,
        last_seen_at: row.last_seen_at ?? now,
        anomaly_code: null,
        updated_at: now,
      }));
      const affectedMechanicIds = [...new Set(carryForwardRows.map((row) => row.mechanic_id))];
      const supabase = createAdminClient();

      if (upserts.length > 0) {
        const { error } = await supabase.from("daily_ticket_item_baselines").upsert(upserts, {
          onConflict: "stat_date,ticket_material_id",
        });

        if (error) {
          throw new Error(`Failed to seed baseline rows: ${error.message}`);
        }
      }

      await recalculateTotals(statDate);

      const result: SyncResult = {
        syncLogId,
        mode,
        statDate,
        httpCalls: 0,
        materialsSeen: 0,
        mappedMaterialsSeen: 0,
        rowsUpserted: upserts.length,
        rowsCorrected: 0,
        anomalyCount: 0,
        details: {
          unmappedProductNos: [],
          missingProductNoCount: 0,
          affectedMechanicIds,
          visibilityAnomalies: [],
        },
        payment: null,
      };

      await completeSyncLog(syncLogId, {
        status: "completed",
        http_calls: 0,
        tickets_seen: 0,
        materials_seen: 0,
        rows_upserted: result.rowsUpserted,
        rows_corrected: 0,
        anomaly_count: 0,
        message: "baseline completed",
        details_json: result.details,
      });

      return result;
    }

    const materialUpdatedAfter = mode === "sync" ? await getLastSuccessfulSyncTimestamp() : atStartOfDay(statDate);
    const paymentWindow = await resolvePaymentUpdatedAfter(mode, materialUpdatedAfter, paymentBackfillDays);
    const mappings = await fetchActiveMappings();
    const mappingByItemNo = new Map(mappings.map((mapping) => [mapping.mechanic_item_no.trim(), mapping]));
    const client = new CustomersFirstClient();
    const ticketTypeByTicketId = new Map<number, string>();
    const unmappedProductNos = new Set<string>();
    const affectedMechanicIds = new Set<string>();
    const visibilityAnomalies: number[] = [];
    let updatedTickets = { normalizedItems: [] as Array<{ ticketId: number; ticketType: string | null }>, httpCalls: 0 };
    let materialDiscoveryHttpCalls = 0;
    let materialHttpCalls = 0;
    let materialsSeen = 0;
    let mappedMaterialsSeen = 0;
    let rowsUpserted = 0;
    let rowsCorrected = 0;
    let anomalyCount = 0;
    let missingProductNoCount = 0;
    let paymentWarning: string | null = null;
    const updatedAfter = paymentWindow.paymentUpdatedAfter;
    const supabase = createAdminClient();

    if (mode === "sync") {
      const [todayRows, fetchedUpdatedTickets] = await Promise.all([
        loadRowsForDate(statDate),
        client.listAllUpdatedTickets(materialUpdatedAfter),
      ]);
      const existingRowsByMaterialId = new Map(todayRows.map((row) => [row.ticket_material_id, row]));
      let updatedMaterialDiscovery: { normalizedItems: NormalizedTicketMaterial[]; httpCalls: number } = {
        normalizedItems: [],
        httpCalls: 0,
      };

      try {
        updatedMaterialDiscovery = await client.listAllUpdatedTicketMaterials(materialUpdatedAfter);
      } catch (error) {
        console.warn(`Material delta sync fell back to ticket sync: ${error instanceof Error ? error.message : String(error)}`);
      }

      updatedTickets = fetchedUpdatedTickets;
      materialDiscoveryHttpCalls = updatedMaterialDiscovery.httpCalls;
      updatedTickets.normalizedItems
        .filter((ticket) => ticket.ticketType !== null)
        .forEach((ticket) => ticketTypeByTicketId.set(ticket.ticketId, ticket.ticketType as string));
      const changedTicketIds = new Set([
      ...updatedTickets.normalizedItems.map((ticket) => ticket.ticketId),
      ...updatedMaterialDiscovery.normalizedItems.map((material) => material.ticketId),
      ]);
      const ticketMaterials = await fetchTicketScopedMaterials([...changedTicketIds]);
      materialHttpCalls = ticketMaterials.httpCalls;
      materialsSeen = ticketMaterials.materialsSeen;
      const allMaterials = [...ticketMaterials.materialsByTicketId.values()].flatMap((materials) => materials);
      const previousRowsByMaterialId = await loadPreviousRowsByMaterialId(
        statDate,
        [...new Set(allMaterials.map((material) => material.ticketMaterialId))],
      );
      const seenMaterialIds = new Set<number>();

      const upserts = allMaterials.flatMap((material) => {
        const productNo = material.productNo?.trim() ?? null;
        if (!productNo) {
          missingProductNoCount += 1;
          return [];
        }

        const mapping = mappingByItemNo.get(productNo);
        if (!mapping) {
          unmappedProductNos.add(productNo);
          return [];
        }

        mappedMaterialsSeen += 1;
        seenMaterialIds.add(material.ticketMaterialId);
        affectedMechanicIds.add(mapping.id);
        const existingRow = existingRowsByMaterialId.get(material.ticketMaterialId) ?? previousRowsByMaterialId.get(material.ticketMaterialId);
        const anomalyCode = buildBaselineAnomaly(existingRow, material, "sync");

        if (anomalyCode !== null) {
          anomalyCount += 1;
          if (anomalyCode === "quantity_decreased" || anomalyCode === "below_baseline_correction") {
            rowsCorrected += 1;
          }
        }

        const baselineQuantity = existingRowsByMaterialId.has(material.ticketMaterialId)
          ? Number(existingRowsByMaterialId.get(material.ticketMaterialId)!.baseline_quantity)
          : existingRow
            ? Number(existingRow.current_quantity)
            : 0;
        const currentQuantity = material.amount;
        const todayAddedQuantity = currentQuantity - baselineQuantity;

        return [
          {
            stat_date: statDate,
            ticket_material_id: material.ticketMaterialId,
            ticket_id: material.ticketId,
            mechanic_id: mapping.id,
            mechanic_item_no: mapping.mechanic_item_no,
            baseline_quantity: roundNumber(baselineQuantity),
            current_quantity: roundNumber(currentQuantity),
            today_added_quantity: roundNumber(todayAddedQuantity),
            today_added_hours: roundNumber(todayAddedQuantity * 0.25),
            source_updated_at: material.updatedAt ?? existingRow?.source_updated_at ?? null,
            source_payment_id: material.paymentId,
            source_amountpaid: material.amountPaid,
            ticket_type: ticketTypeByTicketId.get(material.ticketId) ?? existingRow?.ticket_type ?? null,
            line_total_incl_vat: material.totalInclVat ?? null,
            last_seen_at: now,
            anomaly_code: anomalyCode,
            updated_at: now,
          },
        ];
      });

      const supabase = createAdminClient();
      if (upserts.length > 0) {
        const { error } = await supabase.from("daily_ticket_item_baselines").upsert(upserts, {
          onConflict: "stat_date,ticket_material_id",
        });

        if (error) {
          throw new Error(`Failed to upsert daily baseline rows: ${error.message}`);
        }
      }

      rowsUpserted = upserts.length;

      const invisibleRows = todayRows.filter((row) => changedTicketIds.has(row.ticket_id) && !seenMaterialIds.has(row.ticket_material_id));
      if (invisibleRows.length > 0) {
        visibilityAnomalies.push(...invisibleRows.map((row) => row.ticket_material_id));
        anomalyCount += invisibleRows.length;
        rowsCorrected += invisibleRows.length;

        const invisibleUpserts = invisibleRows.map((row) => {
          const baselineQuantity = Number(row.baseline_quantity);
          const todayAddedQuantity = 0 - baselineQuantity;

          affectedMechanicIds.add(row.mechanic_id as string);

          return {
            stat_date: statDate,
            ticket_material_id: row.ticket_material_id,
            ticket_id: row.ticket_id,
            mechanic_id: row.mechanic_id,
            mechanic_item_no: row.mechanic_item_no,
            baseline_quantity: roundNumber(baselineQuantity),
            current_quantity: 0,
            today_added_quantity: roundNumber(todayAddedQuantity),
            today_added_hours: roundNumber(todayAddedQuantity * 0.25),
            source_updated_at: row.source_updated_at,
            source_payment_id: row.source_payment_id,
            source_amountpaid: row.source_amountpaid,
            ticket_type: row.ticket_type ?? null,
            last_seen_at: now,
            anomaly_code: "missing_in_latest_fetch",
            updated_at: now,
          };
        });

        const { error } = await supabase.from("daily_ticket_item_baselines").upsert(invisibleUpserts, {
          onConflict: "stat_date,ticket_material_id",
        });

        if (error) {
          throw new Error(`Failed to flag visibility anomalies and update quantities: ${error.message}`);
        }
      }

      await recalculateTotals(statDate);

      if (ticketTypeByTicketId.size > 0) {
        try {
          await upsertTicketTypeCache(ticketTypeByTicketId, now);
        } catch (error) {
          paymentWarning = combineSyncMessages(
            paymentWarning,
            error instanceof Error ? error.message : String(error),
          );
        }
      }

    if (false) {
      // Legacy payment sync path kept inert while the new backfill-aware flow runs below.
      try {
      const updatedPayments = await client.listAllUpdatedPayments(updatedAfter);

      if (updatedPayments.normalizedItems.length > 0) {
        // Load ticket type cache for ALL task IDs referenced by these payments
        const allTaskIds = [...new Set(updatedPayments.normalizedItems.flatMap((p) => p.taskIds))];
        const cachedTicketTypes = new Map<number, string>();
        const baselineTicketTypes = await loadLatestBaselineTicketTypes(allTaskIds);

        if (allTaskIds.length > 0) {
          const { data: cachedRows } = await supabase
            .from("ticket_type_cache")
            .select("ticket_id, ticket_type")
            .in("ticket_id", allTaskIds);

          for (const row of (cachedRows ?? []) as Array<{ ticket_id: number; ticket_type: string | null }>) {
            if (row.ticket_type) {
              cachedTicketTypes.set(row.ticket_id, row.ticket_type as string);
            }
          }
        }

        const paymentUpserts = updatedPayments.normalizedItems.map((payment) => {
          // Payment date is required to bucket by correct day
          const paymentDate = payment.paymentDate ?? statDate;

          // Sum article totals: all articles → ticket total, mechanic-item articles → mechanic total
          let mechanicTotal = 0;
          let ticketTotal = 0;

          for (const article of payment.articles) {
            ticketTotal += article.totalInclVat;
            const productNo = article.productNo?.trim() ?? null;
            if (productNo && mappingByItemNo.has(productNo)) {
              mechanicTotal += article.totalInclVat;
            }
          }

          // Determine if this is a repair payment based on associated ticket types
          const isRepair = payment.taskIds.some(
            (id) =>
              // From this sync's ticket data
              ticketTypeByTicketId.get(id) === "repair" ||
              // Or from the persisted cache
              cachedTicketTypes.get(id) === "repair" ||
              // Or from the latest local baseline history
              baselineTicketTypes.get(id) === "repair",
          );

          return {
            payment_id: payment.paymentId,
            payment_date: paymentDate,
            mechanic_total_incl_vat: roundNumber(mechanicTotal),
            ticket_total_incl_vat: roundNumber(ticketTotal),
            is_repair: isRepair,
            updated_at: now,
          };
        });

        if (paymentUpserts.length > 0) {
          const { error: paymentError } = await supabase.from("daily_payment_summary").upsert(paymentUpserts, {
            onConflict: "payment_id",
          });

          if (paymentError) {
            throw new Error(`Failed to upsert daily_payment_summary: ${paymentError?.message ?? "unknown error"}`);
          }
        }
      }
    } catch (caughtPaymentError) {
      // Payment sync is non-critical for mechanic hour tracking – log but don't fail the sync
      const paymentErrorMessage = caughtPaymentError instanceof Error ? (caughtPaymentError as Error).message : String(caughtPaymentError);
      console.warn(`Payment sync step failed: ${paymentErrorMessage}`);
    }

    }

    // Update CykelPlus customer count snapshot
    if (mode === "sync") {
      try {
        const config = getServerConfig();
      const cykelPlusCount = await client.getCykelPlusCustomerCount(config.cykelPlusTag);
      const supabaseCykelPlus = createAdminClient();
      await supabaseCykelPlus.from("cykelplus_snapshots").upsert(
        { snapshot_date: statDate, customer_count: cykelPlusCount, updated_at: now },
        { onConflict: "snapshot_date" },
      );
    } catch {
      // Non-critical – do not fail the sync if CykelPlus count fails
    }

    }

    }

    let payment: PaymentSyncMetrics;
    try {
      payment = await syncPayments({
        client,
        paymentUpdatedAfter: paymentWindow.paymentUpdatedAfter,
        paymentBackfillWindowDays: paymentWindow.paymentBackfillWindowDays,
        ticketTypeByTicketId,
        mappingByItemNo,
        now,
        statDate,
      });
    } catch (error) {
      const paymentError = error instanceof Error ? error.message : String(error);
      payment = {
        httpCalls: 0,
        paymentsSeen: 0,
        paymentsUpserted: 0,
        paymentUpdatedAfter: paymentWindow.paymentUpdatedAfter,
        paymentBackfillWindowDays: paymentWindow.paymentBackfillWindowDays,
        paymentError,
        ticketLookupCount: 0,
        ticketLookupMissCount: 0,
      };

      if (mode === "payments_backfill") {
        throw error;
      }

      paymentWarning = combineSyncMessages(paymentWarning, paymentError);
    }

    if (paymentWarning) {
      payment = {
        ...payment,
        paymentError: combineSyncMessages(payment.paymentError, paymentWarning),
      };
    }

    const result: SyncResult = {
      syncLogId,
      mode,
      statDate,
      httpCalls: updatedTickets.httpCalls + materialDiscoveryHttpCalls + materialHttpCalls + payment.httpCalls,
      materialsSeen,
      mappedMaterialsSeen,
      rowsUpserted,
      rowsCorrected,
      anomalyCount,
      details: {
        unmappedProductNos: [...unmappedProductNos].sort(),
        missingProductNoCount,
        affectedMechanicIds: [...affectedMechanicIds],
        visibilityAnomalies,
      },
      payment,
    };

    await completeSyncLog(syncLogId, {
      status: payment.paymentError ? "completed_with_warning" : "completed",
      http_calls: result.httpCalls,
      tickets_seen: updatedTickets.normalizedItems.length,
      materials_seen: result.materialsSeen,
      rows_upserted: result.rowsUpserted,
      rows_corrected: result.rowsCorrected,
      anomaly_count: result.anomalyCount,
      message: payment.paymentError ? `${mode} completed with payment warning` : `${mode} completed`,
      details_json: {
        ...result.details,
        updatedAfter: mode === "sync" ? materialUpdatedAfter : null,
        payments_seen: payment.paymentsSeen,
        payments_upserted: payment.paymentsUpserted,
        payment_updated_after: payment.paymentUpdatedAfter,
        payment_backfill_window_days: payment.paymentBackfillWindowDays,
        payment_error: payment.paymentError,
        ticket_lookup_count: payment.ticketLookupCount,
        ticket_lookup_miss_count: payment.ticketLookupMissCount,
      },
    });

    return result;
  } catch (error) {
    await completeSyncLog(syncLogId, {
      status: "failed",
      message: error instanceof Error ? error.message : "Unknown sync failure",
      details_json: {},
    });
    throw error;
  }
}

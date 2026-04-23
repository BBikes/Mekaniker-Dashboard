import "server-only";

import { CustomersFirstClient } from "@/lib/c1st/client";
import type { NormalizedTicketMaterial } from "@/lib/c1st/normalize-ticket-material";
import { createAdminClient } from "@/lib/supabase/server";
import { getServerConfig } from "@/lib/env";
import { getDailyTargetHoursForDate } from "@/lib/targets";
import { addDays, getCopenhagenDateString, toIsoTimestamp } from "@/lib/time";

const SCHEDULED_SYNC_LOCK_MINUTES = 20;
const SYNC_CURSOR_OVERLAP_MINUTES = 2;
const DEFAULT_PAYMENT_BACKFILL_DAYS = 7;
const DEFAULT_MANUAL_SYNC_LOOKBACK_HOURS = 48;
const SUCCESSFUL_SYNC_STATUSES = ["completed", "completed_with_warning"] as const;

type MechanicMapping = {
  id: string;
  mechanic_name: string;
  mechanic_item_no: string;
  display_order: number;
  active: boolean;
};

type SyncState = "ok" | "unresolved_missing" | "recovered" | "adjusted" | "replaced";
type SyncAnomalyCategory =
  | "same_day_negative_correction"
  | "material_date_mismatch"
  | "missing_mapping"
  | "missing_lifecycle";

type DailyBaselineRow = {
  stat_date: string;
  ticket_id: number;
  mechanic_item_no: string;
  mechanic_id: string;
  baseline_quantity: number;
  current_quantity: number;
  today_added_quantity?: number | null;
  today_added_hours?: number | null;
  source_payment_id: number | null;
  source_amountpaid: number | null;
  source_updated_at: string | null;
  source_stat_date?: string | null;
  source_decision_reason?: string | null;
  source_sync_event_id?: string | null;
  ticket_material_id: number;
  ticket_type?: string | null;
  line_total_incl_vat?: number | null;
  last_seen_at: string | null;
  anomaly_code?: string | null;
  sync_state?: SyncState | null;
  last_validated_at?: string | null;
  missing_since?: string | null;
  resolved_at?: string | null;
};

type DailyBaselineUpsert = {
  stat_date: string;
  ticket_material_id: number;
  ticket_id: number;
  mechanic_id: string;
  mechanic_item_no: string;
  baseline_quantity: number;
  current_quantity: number;
  today_added_quantity: number;
  today_added_hours: number;
  source_updated_at: string | null;
  source_stat_date: string | null;
  source_decision_reason: string | null;
  source_sync_event_id: string | null;
  source_payment_id: number | null;
  source_amountpaid: number | null;
  ticket_type: string | null;
  line_total_incl_vat?: number | null;
  last_seen_at: string | null;
  anomaly_code: string | null;
  sync_state: SyncState;
  last_validated_at: string | null;
  missing_since: string | null;
  resolved_at: string | null;
  updated_at: string;
};

type SyncAnomalyLogUpsert = {
  stat_date: string;
  sync_event_id: string;
  ticket_id: number;
  ticket_material_id: number;
  mechanic_item_no: string;
  mechanic_name: string | null;
  category: SyncAnomalyCategory;
  resolution: string;
  notes: string;
  previous_current_qty?: number | null;
  previous_today_added?: number | null;
  recovered_current_qty?: number | null;
  recovered_today_added?: number | null;
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
    activeProductNos: string[];
    mappedMaterialsSeen: number;
    validationTicketsChecked: number;
    unresolvedMissingMaterialIds: number[];
    recoveredMaterialIds: number[];
    skippedProductNos: string[];
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

function hoursAgoIso(hours: number, from = new Date()) {
  return new Date(from.getTime() - hours * 60 * 60 * 1000).toISOString();
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

async function fetchTicketScopedMaterials(ticketIds: number[], client = new CustomersFirstClient()) {
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

type UpdatedMaterialDiscovery = {
  normalizedItems: NormalizedTicketMaterial[];
  httpCalls: number;
  skippedProductNos: string[];
  ticketTypeByTicketId: Map<number, string>;
  prefetchedMaterialsByTicketId: Map<number, NormalizedTicketMaterial[]>;
};

async function discoverUpdatedMaterials({
  updatedAfter,
  activeProductNos,
  useUpdatedAfter,
  allowFallbackSweep,
  client,
}: {
  updatedAfter: string;
  activeProductNos: string[];
  useUpdatedAfter: boolean;
  allowFallbackSweep: boolean;
  client: CustomersFirstClient;
}): Promise<UpdatedMaterialDiscovery> {
  if (activeProductNos.length === 0) {
    return {
      normalizedItems: [],
      httpCalls: 0,
      skippedProductNos: [],
      ticketTypeByTicketId: new Map<number, string>(),
      prefetchedMaterialsByTicketId: new Map<number, NormalizedTicketMaterial[]>(),
    };
  }

  if (useUpdatedAfter) {
    const filteredDiscovery = await client.listAllUpdatedTicketMaterialsForProductNos(updatedAfter, activeProductNos, {
      allowFallbackSweep,
    });
    return {
      normalizedItems: filteredDiscovery.normalizedItems,
      httpCalls: filteredDiscovery.httpCalls,
      skippedProductNos: filteredDiscovery.skippedProductNos ?? [],
      ticketTypeByTicketId: new Map<number, string>(),
      prefetchedMaterialsByTicketId: new Map<number, NormalizedTicketMaterial[]>(),
    };
  }

  const updatedTickets = await client.listAllUpdatedTickets(updatedAfter);
  const ticketTypeByTicketId = new Map<number, string>();
  for (const ticket of updatedTickets.normalizedItems) {
    if (ticket.ticketType) {
      ticketTypeByTicketId.set(ticket.ticketId, ticket.ticketType);
    }
  }

  const prefetchedMaterials = await fetchTicketScopedMaterials(
    updatedTickets.normalizedItems.map((ticket) => ticket.ticketId),
    client,
  );
  const activeProductNoSet = new Set(activeProductNos);
  const normalizedItems: NormalizedTicketMaterial[] = [];

  for (const materials of prefetchedMaterials.materialsByTicketId.values()) {
    for (const material of materials) {
      const productNo = getProductNo(material);
      if (!productNo || !activeProductNoSet.has(productNo)) {
        continue;
      }

      normalizedItems.push(material);
    }
  }

  return {
    normalizedItems,
    httpCalls: updatedTickets.httpCalls + prefetchedMaterials.httpCalls,
    skippedProductNos: [],
    ticketTypeByTicketId,
    prefetchedMaterialsByTicketId: prefetchedMaterials.materialsByTicketId,
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
      today_added_quantity,
      today_added_hours,
      source_payment_id,
      source_amountpaid,
      source_updated_at,
      source_stat_date,
      source_decision_reason,
      source_sync_event_id,
      ticket_material_id,
      ticket_type,
      line_total_incl_vat,
      last_seen_at,
      anomaly_code,
      sync_state,
      last_validated_at,
      missing_since,
      resolved_at
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
      today_added_quantity,
      today_added_hours,
      source_payment_id,
      source_amountpaid,
      source_updated_at,
      source_stat_date,
      source_decision_reason,
      source_sync_event_id,
      ticket_material_id,
      ticket_type,
      line_total_incl_vat,
      last_seen_at,
      anomaly_code,
      sync_state,
      last_validated_at,
      missing_since,
      resolved_at
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
  // Use addDays(statDate, -1) instead of dateDaysAgo(1) to derive the previous date
  // directly from statDate — not from the current wall-clock time. This prevents an
  // off-by-one error when the function is called around midnight.
  const previousDate = addDays(statDate, -1);
  const [todayRows, previousRows] = await Promise.all([loadRowsForDate(statDate), loadRowsForDate(previousDate)]);
  const existingToday = new Set(todayRows.map((row) => row.ticket_material_id));

  return previousRows.filter(
    (row) => row.source_payment_id === null && row.sync_state !== "replaced" && !existingToday.has(row.ticket_material_id),
  );
}

async function autoAcknowledgeMissingRows(statDate: string, now: string) {
  const supabase = createAdminClient();
  const { data: rows, error: selectError } = await supabase
    .from("daily_ticket_item_baselines")
    .select("ticket_material_id")
    .lt("stat_date", statDate)
    .eq("sync_state", "unresolved_missing");

  if (selectError) {
    console.error("autoAcknowledgeMissingRows failed:", selectError.message);
    return;
  }

  const materialIds = [...new Set((rows ?? []).map((row) => Number(row.ticket_material_id)).filter(Boolean))];
  if (materialIds.length === 0) {
    return;
  }

  const { error } = await supabase
    .from("daily_ticket_item_baselines")
    .update({ sync_state: "adjusted", resolved_at: now, updated_at: now })
    .in("ticket_material_id", materialIds)
    .eq("sync_state", "unresolved_missing");

  if (error) {
    console.error("autoAcknowledgeMissingRows failed:", error.message);
  }
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

function getProductNo(material: NormalizedTicketMaterial) {
  return material.productNo?.trim() ?? null;
}

function getActiveProductNos(mappings: MechanicMapping[]) {
  return [...new Set(mappings.map((mapping) => mapping.mechanic_item_no.trim()).filter(Boolean))];
}

function calculateTodayAddedQuantity(currentQuantity: number, baselineQuantity: number) {
  return currentQuantity - baselineQuantity;
}

function getSameMechanicRow(row: DailyBaselineRow | undefined, mechanicId: string) {
  return row?.mechanic_id === mechanicId ? row : undefined;
}

function toDailyBaselineRow(row: DailyBaselineUpsert): DailyBaselineRow {
  return {
    stat_date: row.stat_date,
    ticket_id: row.ticket_id,
    mechanic_item_no: row.mechanic_item_no,
    mechanic_id: row.mechanic_id,
    baseline_quantity: row.baseline_quantity,
    current_quantity: row.current_quantity,
    today_added_quantity: row.today_added_quantity,
    today_added_hours: row.today_added_hours,
    source_payment_id: row.source_payment_id,
    source_amountpaid: row.source_amountpaid,
    source_updated_at: row.source_updated_at,
    source_stat_date: row.source_stat_date,
    source_decision_reason: row.source_decision_reason,
    source_sync_event_id: row.source_sync_event_id,
    ticket_material_id: row.ticket_material_id,
    ticket_type: row.ticket_type,
    line_total_incl_vat: row.line_total_incl_vat ?? null,
    last_seen_at: row.last_seen_at,
    anomaly_code: row.anomaly_code,
    sync_state: row.sync_state,
    last_validated_at: row.last_validated_at,
    missing_since: row.missing_since,
    resolved_at: row.resolved_at,
  };
}

function mergeTodayRows(todayRows: DailyBaselineRow[], upserts: DailyBaselineUpsert[]) {
  const byMaterialId = new Map<number, DailyBaselineRow>();

  for (const row of todayRows) {
    byMaterialId.set(row.ticket_material_id, row);
  }

  for (const upsert of upserts) {
    byMaterialId.set(upsert.ticket_material_id, toDailyBaselineRow(upsert));
  }

  return [...byMaterialId.values()];
}

function buildMaterialUpsert({
  statDate,
  now,
  syncLogId,
  material,
  mapping,
  todayRow,
  previousRow,
  ticketType,
}: {
  statDate: string;
  now: string;
  syncLogId: string;
  material: NormalizedTicketMaterial;
  mapping: MechanicMapping;
  todayRow?: DailyBaselineRow;
  previousRow?: DailyBaselineRow;
  ticketType?: string | null;
}): DailyBaselineUpsert {
  const materialStatDate = resolveMaterialStatDate(material, statDate);
  const sameMechanicTodayRow = getSameMechanicRow(todayRow, mapping.id);
  const sameMechanicPreviousRow = getSameMechanicRow(previousRow, mapping.id);
  const existingRow = sameMechanicTodayRow ?? sameMechanicPreviousRow;
  const baselineQuantity = sameMechanicTodayRow
    ? Number(sameMechanicTodayRow.baseline_quantity)
    : sameMechanicPreviousRow
      ? Number(sameMechanicPreviousRow.current_quantity)
      : 0;
  const currentQuantity = material.amount;
  const todayAddedQuantity = calculateTodayAddedQuantity(currentQuantity, baselineQuantity);
  const anomalyCode = buildBaselineAnomaly(existingRow, material, "sync");
  const previousSyncState = sameMechanicTodayRow?.sync_state ?? null;
  const syncState: SyncState = previousSyncState === "unresolved_missing"
    ? "recovered"
    : anomalyCode
      ? "adjusted"
      : "ok";

  return {
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
    source_stat_date: materialStatDate,
    source_decision_reason: "included_matching_source_date",
    source_sync_event_id: syncLogId,
    source_payment_id: material.paymentId,
    source_amountpaid: material.amountPaid,
    ticket_type: ticketType ?? existingRow?.ticket_type ?? null,
    line_total_incl_vat: material.totalInclVat ?? existingRow?.line_total_incl_vat ?? null,
    last_seen_at: now,
    anomaly_code: anomalyCode,
    sync_state: syncState,
    last_validated_at: now,
    missing_since: null,
    resolved_at: previousSyncState === "unresolved_missing" ? now : null,
    updated_at: now,
  };
}

function buildUnresolvedMissingUpsert(row: DailyBaselineRow, now: string, syncLogId: string): DailyBaselineUpsert {
  const todayAddedQuantity = Number(row.today_added_quantity ?? 0);

  return {
    stat_date: row.stat_date,
    ticket_material_id: row.ticket_material_id,
    ticket_id: row.ticket_id,
    mechanic_id: row.mechanic_id,
    mechanic_item_no: row.mechanic_item_no,
    baseline_quantity: roundNumber(Number(row.baseline_quantity)),
    current_quantity: roundNumber(Number(row.current_quantity)),
    today_added_quantity: roundNumber(todayAddedQuantity),
    today_added_hours: roundNumber(todayAddedQuantity * 0.25),
    source_updated_at: row.source_updated_at,
    source_stat_date: row.source_stat_date ?? row.stat_date,
    source_decision_reason: "retained_missing_in_latest_fetch",
    source_sync_event_id: syncLogId,
    source_payment_id: row.source_payment_id,
    source_amountpaid: row.source_amountpaid,
    ticket_type: row.ticket_type ?? null,
    line_total_incl_vat: row.line_total_incl_vat ?? null,
    last_seen_at: row.last_seen_at,
    anomaly_code: "missing_in_latest_fetch",
    sync_state: "unresolved_missing",
    last_validated_at: now,
    missing_since: row.missing_since ?? now,
    resolved_at: null,
    updated_at: now,
  };
}

function buildReplacedUpsert(row: DailyBaselineRow, now: string, syncLogId: string): DailyBaselineUpsert {
  const baselineQuantity = Number(row.baseline_quantity);

  return {
    stat_date: row.stat_date,
    ticket_material_id: row.ticket_material_id,
    ticket_id: row.ticket_id,
    mechanic_id: row.mechanic_id,
    mechanic_item_no: row.mechanic_item_no,
    baseline_quantity: roundNumber(baselineQuantity),
    current_quantity: roundNumber(baselineQuantity),
    today_added_quantity: 0,
    today_added_hours: 0,
    source_updated_at: row.source_updated_at,
    source_stat_date: row.source_stat_date ?? row.stat_date,
    source_decision_reason: "replaced_by_new_material",
    source_sync_event_id: syncLogId,
    source_payment_id: row.source_payment_id,
    source_amountpaid: row.source_amountpaid,
    ticket_type: row.ticket_type ?? null,
    line_total_incl_vat: row.line_total_incl_vat ?? null,
    last_seen_at: row.last_seen_at,
    anomaly_code: "replaced_by_new_material",
    sync_state: "replaced",
    last_validated_at: now,
    missing_since: null,
    resolved_at: now,
    updated_at: now,
  };
}

async function upsertBaselineRows(upserts: DailyBaselineUpsert[], errorContext: string) {
  if (upserts.length === 0) {
    return;
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("daily_ticket_item_baselines").upsert(upserts, {
    onConflict: "stat_date,ticket_material_id",
  });

  if (error) {
    throw new Error(`${errorContext}: ${error.message}`);
  }
}

async function upsertSyncAnomalyRows(rows: SyncAnomalyLogUpsert[], warningPrefix: string) {
  if (rows.length === 0) {
    return;
  }

  const { error } = await createAdminClient().from("sync_anomaly_log").upsert(rows, {
    onConflict: "stat_date,ticket_material_id,category",
  });

  if (error) {
    console.warn(`${warningPrefix}: ${error.message}`);
  }
}

async function logUnresolvedMissingRows({
  syncLogId,
  upserts,
  mappings,
}: {
  syncLogId: string;
  upserts: DailyBaselineUpsert[];
  mappings: MechanicMapping[];
}) {
  if (upserts.length === 0) {
    return;
  }

  const mechanicNameById = new Map(mappings.map((mapping) => [mapping.id, mapping.mechanic_name]));
  const anomalyLogInserts: SyncAnomalyLogUpsert[] = upserts.map((row) => ({
    stat_date: row.stat_date,
    sync_event_id: syncLogId,
    ticket_id: row.ticket_id,
    ticket_material_id: row.ticket_material_id,
    mechanic_item_no: row.mechanic_item_no,
    mechanic_name: mechanicNameById.get(row.mechanic_id) ?? null,
    category: "missing_lifecycle",
    previous_current_qty: row.current_quantity,
    previous_today_added: row.today_added_quantity,
    resolution: "confirmed_missing",
    notes: `Known mechanic line missing from validation fetch for ticket ${row.ticket_id}. Today's quantity was preserved.`,
  }));

  await upsertSyncAnomalyRows(anomalyLogInserts, "Anomaly log upsert failed");
}

async function logMissingMappingRows({
  syncLogId,
  statDate,
  rows,
}: {
  syncLogId: string;
  statDate: string;
  rows: Array<{ material: NormalizedTicketMaterial; productNo: string }>;
}) {
  const inserts: SyncAnomalyLogUpsert[] = rows.map(({ material, productNo }) => ({
    stat_date: statDate,
    sync_event_id: syncLogId,
    ticket_id: material.ticketId,
    ticket_material_id: material.ticketMaterialId,
    mechanic_item_no: productNo,
    mechanic_name: null,
    category: "missing_mapping",
    resolution: "confirmed_missing",
    notes: `Skipped in daily totals: no active mechanic mapping for product ${productNo}.`,
  }));

  await upsertSyncAnomalyRows(inserts, "Missing mapping anomaly upsert failed");
}

async function logOutOfDateMaterialRows({
  syncLogId,
  statDate,
  rows,
  mappings,
}: {
  syncLogId: string;
  statDate: string;
  rows: Array<{ material: NormalizedTicketMaterial; mapping: MechanicMapping; materialStatDate: string | null }>;
  mappings: MechanicMapping[];
}) {
  if (rows.length === 0) {
    return;
  }

  const mechanicNameById = new Map(mappings.map((mapping) => [mapping.id, mapping.mechanic_name]));
  const inserts: SyncAnomalyLogUpsert[] = rows.map(({ material, mapping, materialStatDate }) => ({
    stat_date: statDate,
    sync_event_id: syncLogId,
    ticket_id: material.ticketId,
    ticket_material_id: material.ticketMaterialId,
    mechanic_item_no: mapping.mechanic_item_no,
    mechanic_name: mechanicNameById.get(mapping.id) ?? null,
    category: "material_date_mismatch",
    resolution: "confirmed_missing",
    notes: `Skipped in daily totals: material stat date ${materialStatDate ?? "unknown"} does not match ${statDate}.`,
  }));

  await upsertSyncAnomalyRows(inserts, "Out-of-date material anomaly upsert failed");
}

async function logNegativeCorrectionRows({
  syncLogId,
  upserts,
  mappings,
}: {
  syncLogId: string;
  upserts: DailyBaselineUpsert[];
  mappings: MechanicMapping[];
}) {
  const negativeRows = upserts.filter((row) => row.today_added_quantity < 0);
  if (negativeRows.length === 0) {
    return;
  }

  const mechanicNameById = new Map(mappings.map((mapping) => [mapping.id, mapping.mechanic_name]));
  const rows: SyncAnomalyLogUpsert[] = negativeRows.map((row) => ({
    stat_date: row.stat_date,
    sync_event_id: syncLogId,
    ticket_id: row.ticket_id,
    ticket_material_id: row.ticket_material_id,
    mechanic_item_no: row.mechanic_item_no,
    mechanic_name: mechanicNameById.get(row.mechanic_id) ?? null,
    category: "same_day_negative_correction",
    resolution: "confirmed_missing",
    previous_current_qty: row.current_quantity,
    previous_today_added: row.today_added_quantity,
    notes: `Same-day correction produced ${row.today_added_quantity} quarters for ticket ${row.ticket_id}.`,
  }));

  await upsertSyncAnomalyRows(rows, "Negative correction anomaly upsert failed");
}

async function markRecoveredAnomalyLog(statDate: string, recoveredMaterialIds: number[]) {
  if (recoveredMaterialIds.length === 0) {
    return;
  }

  const { error } = await createAdminClient()
    .from("sync_anomaly_log")
    .update({
      resolution: "auto_recovered",
      notes: "Recovered by stable mechanic-line validation.",
    })
    .eq("stat_date", statDate)
    .eq("category", "missing_lifecycle")
    .eq("resolution", "confirmed_missing")
    .in("ticket_material_id", recoveredMaterialIds);

  if (error) {
    console.warn(`Anomaly log recovery update failed: ${error.message}`);
  }
}

type ValidationResult = {
  httpCalls: number;
  materialsSeen: number;
  mappedMaterialsSeen: number;
  validationTicketsChecked: number;
  upserts: DailyBaselineUpsert[];
  rowsCorrected: number;
  anomalyCount: number;
  unresolvedMissingMaterialIds: number[];
  recoveredMaterialIds: number[];
};

async function validateKnownRows({
  statDate,
  now,
  syncLogId,
  rows,
  mappings,
  mappingByItemNo,
  client,
  prefetchedMaterialsByTicketId = new Map<number, NormalizedTicketMaterial[]>(),
}: {
  statDate: string;
  now: string;
  syncLogId: string;
  rows: DailyBaselineRow[];
  mappings: MechanicMapping[];
  mappingByItemNo: Map<string, MechanicMapping>;
  client: CustomersFirstClient;
  prefetchedMaterialsByTicketId?: Map<number, NormalizedTicketMaterial[]>;
}): Promise<ValidationResult> {
  const rowsToValidate = rows.filter((row) => {
    if (row.sync_state === "replaced") {
      return false;
    }

    const mapping = mappingByItemNo.get(row.mechanic_item_no.trim());
    return mapping?.id === row.mechanic_id;
  });

  if (rowsToValidate.length === 0) {
    return {
      httpCalls: 0,
      materialsSeen: 0,
      mappedMaterialsSeen: 0,
      validationTicketsChecked: 0,
      upserts: [],
      rowsCorrected: 0,
      anomalyCount: 0,
      unresolvedMissingMaterialIds: [],
      recoveredMaterialIds: [],
    };
  }

  const ticketIds = [...new Set(rowsToValidate.map((row) => row.ticket_id))];
  const ticketsToFetch = ticketIds.filter((id) => !prefetchedMaterialsByTicketId.has(id));
  const freshFetch = ticketsToFetch.length > 0
    ? await fetchTicketScopedMaterials(ticketsToFetch, client)
    : { materialsByTicketId: new Map<number, NormalizedTicketMaterial[]>(), httpCalls: 0, materialsSeen: 0 };

  const mergedMaterialsByTicketId = new Map<number, NormalizedTicketMaterial[]>([
    ...prefetchedMaterialsByTicketId.entries(),
    ...freshFetch.materialsByTicketId.entries(),
  ]);

  const validationFetch = {
    httpCalls: freshFetch.httpCalls,
    materialsSeen: freshFetch.materialsSeen + [...prefetchedMaterialsByTicketId.values()].reduce((s, m) => s + m.length, 0),
    materialsByTicketId: mergedMaterialsByTicketId,
  };

  const materialsById = new Map<number, NormalizedTicketMaterial>();
  const activeMaterialsByTicketMechanic = new Map<string, NormalizedTicketMaterial[]>();
  let mappedMaterialsSeen = 0;

  for (const materials of validationFetch.materialsByTicketId.values()) {
    for (const material of materials) {
      const materialStatDate = resolveMaterialStatDate(material, statDate);
      if (materialStatDate !== statDate) {
        continue;
      }

      materialsById.set(material.ticketMaterialId, material);
      const productNo = getProductNo(material);
      const mapping = productNo ? mappingByItemNo.get(productNo) : undefined;
      if (!mapping) {
        continue;
      }

      mappedMaterialsSeen += 1;
      const key = `${material.ticketId}:${mapping.id}`;
      const current = activeMaterialsByTicketMechanic.get(key) ?? [];
      current.push(material);
      activeMaterialsByTicketMechanic.set(key, current);
    }
  }

  const upserts: DailyBaselineUpsert[] = [];
  const unresolvedMissingMaterialIds: number[] = [];
  const recoveredMaterialIds: number[] = [];
  let rowsCorrected = 0;
  let anomalyCount = 0;

  for (const row of rowsToValidate) {
    const material = materialsById.get(row.ticket_material_id);
    const productNo = material ? getProductNo(material) : null;
    const mapping = productNo ? mappingByItemNo.get(productNo) : undefined;

    if (material && mapping?.id === row.mechanic_id) {
      const upsert = buildMaterialUpsert({
        statDate,
        now,
        syncLogId,
        material,
        mapping,
        todayRow: row,
        ticketType: row.ticket_type ?? null,
      });

      if (row.sync_state === "unresolved_missing") {
        recoveredMaterialIds.push(row.ticket_material_id);
        rowsCorrected += 1;
      } else if (Number(row.current_quantity) !== material.amount || row.anomaly_code !== upsert.anomaly_code) {
        rowsCorrected += 1;
      }

      if (upsert.anomaly_code && (row.anomaly_code !== upsert.anomaly_code || row.sync_state !== upsert.sync_state)) {
        anomalyCount += 1;
      }

      upserts.push(upsert);
      continue;
    }

    const replacementCandidates = activeMaterialsByTicketMechanic.get(`${row.ticket_id}:${row.mechanic_id}`) ?? [];
    const hasReplacement = replacementCandidates.some((candidate) => candidate.ticketMaterialId !== row.ticket_material_id);

    if (hasReplacement) {
      upserts.push(buildReplacedUpsert(row, now, syncLogId));
      rowsCorrected += 1;
      continue;
    }

    const unresolved = buildUnresolvedMissingUpsert(row, now, syncLogId);
    upserts.push(unresolved);
    unresolvedMissingMaterialIds.push(row.ticket_material_id);
    anomalyCount += 1;

    if (row.sync_state !== "unresolved_missing") {
      rowsCorrected += 1;
    }
  }

  return {
    httpCalls: validationFetch.httpCalls,
    materialsSeen: validationFetch.materialsSeen,
    mappedMaterialsSeen,
    validationTicketsChecked: ticketIds.length,
    upserts,
    rowsCorrected,
    anomalyCount,
    unresolvedMissingMaterialIds,
    recoveredMaterialIds,
  };
}


export async function runPhaseOneSync(
  mode: SyncMode,
  options: {
    materialLookbackHours?: number;
    paymentBackfillDays?: number;
    skipCykelPlusSync?: boolean;
    skipPaymentSync?: boolean;
    useFilteredProductDiscovery?: boolean;
    strictProductDiscovery?: boolean;
  } = {},
): Promise<SyncResult> {
  const syncLogId = await createSyncLog(mode);

  try {
    const statDate = getCopenhagenDateString();
    const now = toIsoTimestamp();
    const materialLookbackHours =
      typeof options.materialLookbackHours === "number" && Number.isFinite(options.materialLookbackHours)
        ? Math.max(1, Math.trunc(options.materialLookbackHours))
        : null;
    const paymentBackfillDays = Math.max(1, Math.trunc(options.paymentBackfillDays ?? DEFAULT_PAYMENT_BACKFILL_DAYS));
    const syncConfig = getServerConfig();
    const skipPaymentSync = options.skipPaymentSync === true;
    const skipCykelPlusSync = options.skipCykelPlusSync === true;
    const useFilteredProductDiscovery = options.useFilteredProductDiscovery === true || syncConfig.c1stUseUpdatedAfter;
    const strictProductDiscovery = options.strictProductDiscovery === true;
    console.info("[sync] started", {
      mode,
      syncLogId,
      statDate,
      paymentBackfillDays,
      materialLookbackHours,
      skipPaymentSync,
      skipCykelPlusSync,
      useFilteredProductDiscovery,
      strictProductDiscovery,
    });

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
        source_stat_date: row.source_stat_date ?? row.stat_date,
        source_decision_reason: "baseline_carry_forward",
        source_sync_event_id: syncLogId,
        source_payment_id: row.source_payment_id,
        source_amountpaid: row.source_amountpaid,
        ticket_type: row.ticket_type ?? null,
        last_seen_at: row.last_seen_at ?? now,
        anomaly_code: null,
        sync_state: "ok",
        last_validated_at: now,
        missing_since: null,
        resolved_at: null,
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
          activeProductNos: [],
          mappedMaterialsSeen: 0,
          validationTicketsChecked: 0,
          unresolvedMissingMaterialIds: [],
          recoveredMaterialIds: [],
          skippedProductNos: [],
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

    const materialUpdatedAfter = mode === "sync"
      ? materialLookbackHours !== null
        ? hoursAgoIso(materialLookbackHours)
        : await getLastSuccessfulSyncTimestamp()
      : atStartOfDay(statDate);
    const paymentWindow = await resolvePaymentUpdatedAfter(mode, materialUpdatedAfter, paymentBackfillDays);
    const mappings = await fetchActiveMappings();
    const mappingByItemNo = new Map(mappings.map((mapping) => [mapping.mechanic_item_no.trim(), mapping]));
    const activeProductNos = getActiveProductNos(mappings);
    const client = new CustomersFirstClient();
    const ticketTypeByTicketId = new Map<number, string>();
    const unmappedProductNos = new Set<string>();
    const missingMappingRows: Array<{ material: NormalizedTicketMaterial; productNo: string }> = [];
    const affectedMechanicIds = new Set<string>();
    const visibilityAnomalies: number[] = [];
    const unresolvedMissingMaterialIds: number[] = [];
    const recoveredMaterialIds: number[] = [];
    let materialDiscoveryHttpCalls = 0;
    let materialHttpCalls = 0;
    let materialsSeen = 0;
    let mappedMaterialsSeen = 0;
    let rowsUpserted = 0;
    let rowsCorrected = 0;
    let anomalyCount = 0;
    let missingProductNoCount = 0;
    let validationTicketsChecked = 0;
    let paymentWarning: string | null = null;
    let skippedProductNos: string[] = [];

    if (mode === "sync") {
      const todayRows = await loadRowsForDate(statDate);
      const existingRowsByMaterialId = new Map(todayRows.map((row) => [row.ticket_material_id, row]));
      const outOfDateMappedRows: Array<{
        material: NormalizedTicketMaterial;
        mapping: MechanicMapping;
        materialStatDate: string | null;
      }> = [];
      const discoveryStrategy = useFilteredProductDiscovery ? "materials_by_product" : "tickets_then_materials";
      console.info("[sync] material discovery start", {
        syncLogId,
        strategy: discoveryStrategy,
        updatedAfter: materialUpdatedAfter,
        activeProductCount: activeProductNos.length,
      });
      const updatedMaterialDiscovery = await discoverUpdatedMaterials({
        updatedAfter: materialUpdatedAfter,
        activeProductNos,
        useUpdatedAfter: useFilteredProductDiscovery,
        allowFallbackSweep: !strictProductDiscovery,
        client,
      });
      materialDiscoveryHttpCalls = updatedMaterialDiscovery.httpCalls;
      materialsSeen += updatedMaterialDiscovery.normalizedItems.length;
      skippedProductNos = updatedMaterialDiscovery.skippedProductNos ?? [];
      for (const [ticketId, ticketType] of updatedMaterialDiscovery.ticketTypeByTicketId.entries()) {
        ticketTypeByTicketId.set(ticketId, ticketType);
      }
      const previousRowsByMaterialId = await loadPreviousRowsByMaterialId(
        statDate,
        [...new Set(updatedMaterialDiscovery.normalizedItems.map((material) => material.ticketMaterialId))],
      );
      const upserts: DailyBaselineUpsert[] = [];

      for (const material of updatedMaterialDiscovery.normalizedItems) {
        const productNo = getProductNo(material);
        if (!productNo) {
          missingProductNoCount += 1;
          continue;
        }

        const mapping = mappingByItemNo.get(productNo);
        if (!mapping) {
          unmappedProductNos.add(productNo);
          missingMappingRows.push({ material, productNo });
          continue;
        }

        const materialStatDate = resolveMaterialStatDate(material, statDate);
        if (materialStatDate !== statDate) {
          visibilityAnomalies.push(material.ticketMaterialId);
          outOfDateMappedRows.push({ material, mapping, materialStatDate });
          continue;
        }

        mappedMaterialsSeen += 1;
        affectedMechanicIds.add(mapping.id);
        const upsert = buildMaterialUpsert({
          statDate,
          now,
          syncLogId,
          material,
          mapping,
          todayRow: existingRowsByMaterialId.get(material.ticketMaterialId),
          previousRow: previousRowsByMaterialId.get(material.ticketMaterialId),
          ticketType: ticketTypeByTicketId.get(material.ticketId) ?? null,
        });

        if (upsert.anomaly_code) {
          anomalyCount += 1;
          rowsCorrected += 1;
        }

        upserts.push(upsert);
      }

      anomalyCount += missingMappingRows.length;
      anomalyCount += outOfDateMappedRows.length;

      await logMissingMappingRows({
        syncLogId,
        statDate,
        rows: missingMappingRows,
      });
      await logOutOfDateMaterialRows({
        syncLogId,
        statDate,
        rows: outOfDateMappedRows,
        mappings,
      });
      await logNegativeCorrectionRows({
        syncLogId,
        upserts,
        mappings,
      });

      await upsertBaselineRows(upserts, "Failed to upsert filtered mechanic baseline rows");
      rowsUpserted += upserts.length;

      const mergedRows = mergeTodayRows(todayRows, upserts);
      const mergedRowsByMaterialId = new Map(mergedRows.map((row) => [row.ticket_material_id, row]));
      const validation = await validateKnownRows({
        statDate,
        now,
        syncLogId,
        rows: mergedRows,
        mappings,
        mappingByItemNo,
        client,
        prefetchedMaterialsByTicketId: updatedMaterialDiscovery.prefetchedMaterialsByTicketId,
      });

      await upsertBaselineRows(validation.upserts, "Failed to upsert validated mechanic baseline rows");

      rowsUpserted += validation.upserts.length;
      rowsCorrected += validation.rowsCorrected;
      anomalyCount += validation.anomalyCount;
      materialHttpCalls += validation.httpCalls;
      validationTicketsChecked = validation.validationTicketsChecked;
      unresolvedMissingMaterialIds.push(...validation.unresolvedMissingMaterialIds);
      recoveredMaterialIds.push(...validation.recoveredMaterialIds);

      const newUnresolvedUpserts = validation.upserts.filter((row) => {
        if (row.sync_state !== "unresolved_missing") {
          return false;
        }

        return mergedRowsByMaterialId.get(row.ticket_material_id)?.sync_state !== "unresolved_missing";
      });

      await logUnresolvedMissingRows({
        syncLogId,
        upserts: newUnresolvedUpserts,
        mappings,
      });
      await logNegativeCorrectionRows({
        syncLogId,
        upserts: validation.upserts,
        mappings,
      });
      await markRecoveredAnomalyLog(statDate, validation.recoveredMaterialIds);

      await recalculateTotals(statDate);
      await autoAcknowledgeMissingRows(statDate, now);
      console.info("[sync] material phase complete", {
        syncLogId,
        materialsSeen,
        mappedMaterialsSeen,
        rowsUpserted,
        rowsCorrected,
        anomalyCount,
        validationTicketsChecked,
      });

      if (!syncConfig.syncSkipPayments && !skipCykelPlusSync) {
        try {
          const cykelPlusCount = await client.getCykelPlusCustomerCount(syncConfig.cykelPlusTag);
          await createAdminClient().from("cykelplus_snapshots").upsert(
            { snapshot_date: statDate, customer_count: cykelPlusCount, updated_at: now },
            { onConflict: "snapshot_date" },
          );
        } catch {
          // Non-critical: CykelPlus should not block mechanic-hour sync.
        }
      }
    }

    let payment: PaymentSyncMetrics;
    console.info("[sync] payment phase start", {
      syncLogId,
      mode,
      paymentUpdatedAfter: paymentWindow.paymentUpdatedAfter,
      paymentBackfillWindowDays: paymentWindow.paymentBackfillWindowDays,
      syncSkipPayments: syncConfig.syncSkipPayments || skipPaymentSync,
    });
    if ((syncConfig.syncSkipPayments || skipPaymentSync) && mode !== "payments_backfill") {
      payment = {
        httpCalls: 0,
        paymentsSeen: 0,
        paymentsUpserted: 0,
        paymentUpdatedAfter: paymentWindow.paymentUpdatedAfter,
        paymentBackfillWindowDays: paymentWindow.paymentBackfillWindowDays,
        paymentError: null,
        ticketLookupCount: 0,
        ticketLookupMissCount: 0,
      };
    } else {
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
      httpCalls: materialDiscoveryHttpCalls + materialHttpCalls + payment.httpCalls,
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
        activeProductNos,
        mappedMaterialsSeen,
        validationTicketsChecked,
        unresolvedMissingMaterialIds,
        recoveredMaterialIds,
        skippedProductNos: skippedProductNos ?? [],
      },
      payment,
    };
    const hasSyncWarning = unresolvedMissingMaterialIds.length > 0;
    const hasWarning = hasSyncWarning || Boolean(payment.paymentError);
    const warningMessage = hasSyncWarning
      ? payment.paymentError
        ? `${mode} completed with sync and payment warning`
        : `${mode} completed with sync warning`
      : `${mode} completed with payment warning`;

    await completeSyncLog(syncLogId, {
      status: hasWarning ? "completed_with_warning" : "completed",
      http_calls: result.httpCalls,
      tickets_seen: validationTicketsChecked,
      materials_seen: result.materialsSeen,
      rows_upserted: result.rowsUpserted,
      rows_corrected: result.rowsCorrected,
      anomaly_count: result.anomalyCount,
      message: hasWarning ? warningMessage : `${mode} completed`,
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
        skipped_product_nos: skippedProductNos ?? [],
      },
    });

    console.info("[sync] completed", {
      syncLogId,
      mode,
      status: hasWarning ? "completed_with_warning" : "completed",
      httpCalls: result.httpCalls,
      rowsUpserted: result.rowsUpserted,
      rowsCorrected: result.rowsCorrected,
      anomalyCount: result.anomalyCount,
      paymentError: result.payment?.paymentError ?? null,
    });

    return result;
  } catch (error) {
    console.error("[sync] failed", {
      syncLogId,
      mode,
      error: error instanceof Error ? error.message : String(error),
    });
    await completeSyncLog(syncLogId, {
      status: "failed",
      message: error instanceof Error ? error.message : "Unknown sync failure",
      details_json: {},
    });
    throw error;
  }
}

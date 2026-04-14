import "server-only";

import { CustomersFirstClient } from "@/lib/c1st/client";
import type { NormalizedTicketMaterial } from "@/lib/c1st/normalize-ticket-material";
import { createAdminClient } from "@/lib/supabase/server";
import { getServerConfig } from "@/lib/env";
import { getDailyTargetHoursForDate } from "@/lib/targets";
import { getCopenhagenDateString, toIsoTimestamp } from "@/lib/time";

const SCHEDULED_SYNC_LOCK_MINUTES = 20;

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
  last_seen_at: string | null;
};

export type SyncMode = "baseline" | "sync";
type MaterialSyncLogType = SyncMode;
type SyncLogType = MaterialSyncLogType | "scheduled";

export type SyncResult = {
  syncLogId: string;
  mode: MaterialSyncLogType;
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
    .in("sync_type", ["scheduled", "baseline", "sync"])
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

async function getLastSuccessfulSyncTimestamp() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("sync_event_log")
    .select("finished_at")
    .eq("sync_type", "sync")
    .eq("status", "completed")
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load last successful sync timestamp: ${error.message}`);
  }

  return (data?.finished_at as string | undefined) ?? atStartOfDay(getCopenhagenDateString());
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


export async function runPhaseOneSync(mode: SyncMode): Promise<SyncResult> {
  const syncLogId = await createSyncLog(mode);

  try {
    const statDate = getCopenhagenDateString();
    const now = toIsoTimestamp();

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

    const updatedAfter = await getLastSuccessfulSyncTimestamp();
    const [mappings, todayRows] = await Promise.all([fetchActiveMappings(), loadRowsForDate(statDate)]);
    const mappingByItemNo = new Map(mappings.map((mapping) => [mapping.mechanic_item_no.trim(), mapping]));
    const existingRowsByMaterialId = new Map(todayRows.map((row) => [row.ticket_material_id, row]));
    const client = new CustomersFirstClient();
    const updatedTickets = await client.listAllUpdatedTickets(updatedAfter);
    const ticketTypeByTicketId = new Map(
      updatedTickets.normalizedItems
        .filter((ticket) => ticket.ticketType !== null)
        .map((ticket) => [ticket.ticketId, ticket.ticketType as string]),
    );
    const ticketMaterials = await fetchTicketScopedMaterials(updatedTickets.normalizedItems.map((ticket) => ticket.ticketId));
    const changedTicketIds = new Set(updatedTickets.normalizedItems.map((ticket) => ticket.ticketId));
    const allMaterials = [...ticketMaterials.materialsByTicketId.values()].flatMap((materials) => materials);
    const previousRowsByMaterialId = await loadPreviousRowsByMaterialId(
      statDate,
      [...new Set(allMaterials.map((material) => material.ticketMaterialId))],
    );
    const unmappedProductNos = new Set<string>();
    const affectedMechanicIds = new Set<string>();
    const seenMaterialIds = new Set<number>();
    const visibilityAnomalies: number[] = [];
    let missingProductNoCount = 0;
    let rowsCorrected = 0;
    let anomalyCount = 0;
    let mappedMaterialsSeen = 0;

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
          source_updated_at: material.updatedAt,
          source_payment_id: material.paymentId,
          source_amountpaid: material.amountPaid,
          ticket_type: ticketTypeByTicketId.get(material.ticketId) ?? null,
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

    // --- Update ticket_type_cache for all tickets seen in this sync ---
    if (ticketTypeByTicketId.size > 0) {
      const ticketTypeCacheUpserts = [...ticketTypeByTicketId.entries()].map(([ticketId, ticketType]) => ({
        ticket_id: ticketId,
        ticket_type: ticketType,
        updated_at: now,
      }));

      const { error: cacheError } = await supabase.from("ticket_type_cache").upsert(ticketTypeCacheUpserts, {
        onConflict: "ticket_id",
      });

      if (cacheError) {
        // Non-critical for existing mechanic tracking, but log it
        console.warn(`Failed to upsert ticket_type_cache: ${cacheError.message}`);
      }
    }

    // --- Fetch POS payments updated since last sync and store by actual payment date ---
    try {
      const updatedPayments = await client.listAllUpdatedPayments(updatedAfter);

      if (updatedPayments.normalizedItems.length > 0) {
        // Load ticket type cache for ALL task IDs referenced by these payments
        const allTaskIds = [...new Set(updatedPayments.normalizedItems.flatMap((p) => p.taskIds))];
        const cachedTicketTypes = new Map<number, string>();

        if (allTaskIds.length > 0) {
          const { data: cachedRows } = await supabase
            .from("ticket_type_cache")
            .select("ticket_id, ticket_type")
            .in("ticket_id", allTaskIds);

          for (const row of (cachedRows ?? []) as Array<{ ticket_id: number; ticket_type: string | null }>) {
            if (row.ticket_type) {
              cachedTicketTypes.set(row.ticket_id, row.ticket_type);
            }
          }
        }

        const paymentUpserts = updatedPayments.normalizedItems.flatMap((payment) => {
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
              cachedTicketTypes.get(id) === "repair",
          );

          return [
            {
              payment_id: payment.paymentId,
              payment_date: paymentDate,
              mechanic_total_incl_vat: roundNumber(mechanicTotal),
              ticket_total_incl_vat: roundNumber(ticketTotal),
              is_repair: isRepair,
              updated_at: now,
            },
          ];
        });

        if (paymentUpserts.length > 0) {
          const { error: paymentError } = await supabase.from("daily_payment_summary").upsert(paymentUpserts, {
            onConflict: "payment_id",
          });

          if (paymentError) {
            throw new Error(`Failed to upsert daily_payment_summary: ${paymentError.message}`);
          }
        }
      }
    } catch (paymentError) {
      // Payment sync is non-critical for mechanic hour tracking – log but don't fail the sync
      console.warn(`Payment sync step failed: ${paymentError instanceof Error ? paymentError.message : String(paymentError)}`);
    }

    // Update CykelPlus customer count snapshot
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

    const result: SyncResult = {
      syncLogId,
      mode,
      statDate,
      httpCalls: updatedTickets.httpCalls + ticketMaterials.httpCalls, // payment calls tracked separately
      materialsSeen: ticketMaterials.materialsSeen,
      mappedMaterialsSeen,
      rowsUpserted: upserts.length,
      rowsCorrected,
      anomalyCount,
      details: {
        unmappedProductNos: [...unmappedProductNos].sort(),
        missingProductNoCount,
        affectedMechanicIds: [...affectedMechanicIds],
        visibilityAnomalies,
      },
    };

    await completeSyncLog(syncLogId, {
      status: "completed",
      http_calls: result.httpCalls,
      tickets_seen: updatedTickets.normalizedItems.length,
      materials_seen: result.materialsSeen,
      rows_upserted: result.rowsUpserted,
      rows_corrected: result.rowsCorrected,
      anomaly_count: result.anomalyCount,
      message: `${mode} completed`,
      details_json: {
        ...result.details,
        updatedAfter,
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

import "server-only";

import { CustomersFirstClient } from "@/lib/c1st/client";
import type { NormalizedTicketMaterial } from "@/lib/c1st/normalize-ticket-material";
import { createAdminClient } from "@/lib/supabase/server";
import { getCopenhagenDateString, toIsoTimestamp } from "@/lib/time";

type MechanicMapping = {
  id: string;
  mechanic_name: string;
  mechanic_item_no: string;
  daily_target_hours: number;
  display_order: number;
  active: boolean;
};

type DailyBaselineRow = {
  mechanic_id: string;
  baseline_quantity: number;
  current_quantity: number;
  source_payment_id: number | null;
  ticket_material_id: number;
};

export type SyncMode = "baseline" | "sync";

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
};

function roundNumber(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildBaselineAnomaly(
  existing: DailyBaselineRow | undefined,
  material: NormalizedTicketMaterial,
  mode: SyncMode,
): string | null {
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

async function fetchActiveMappings() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("mechanic_item_mapping")
    .select("id, mechanic_name, mechanic_item_no, daily_target_hours, display_order, active")
    .eq("active", true)
    .order("display_order", { ascending: true })
    .order("mechanic_name", { ascending: true });

  if (error) {
    throw new Error(`Failed to load mechanic mappings: ${error.message}`);
  }

  return (data ?? []) as MechanicMapping[];
}

async function createSyncLog(mode: SyncMode) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("sync_event_log")
    .insert({
      sync_type: mode,
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

async function loadTodayRows(statDate: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("daily_ticket_item_baselines")
    .select("mechanic_id, baseline_quantity, current_quantity, source_payment_id, ticket_material_id")
    .eq("stat_date", statDate);

  if (error) {
    throw new Error(`Failed to load today's baseline rows: ${error.message}`);
  }

  return (data ?? []) as DailyBaselineRow[];
}

async function recalculateTotals(statDate: string, affectedMechanicIds: string[]) {
  if (affectedMechanicIds.length === 0) {
    return;
  }

  const supabase = createAdminClient();
  const uniqueMechanicIds = [...new Set(affectedMechanicIds)];

  const [{ data: baselineRows, error: baselineError }, { data: mappings, error: mappingError }] = await Promise.all([
    supabase
      .from("daily_ticket_item_baselines")
      .select("mechanic_id, today_added_quantity, today_added_hours")
      .eq("stat_date", statDate)
      .in("mechanic_id", uniqueMechanicIds),
    supabase
      .from("mechanic_item_mapping")
      .select("id, daily_target_hours")
      .in("id", uniqueMechanicIds),
  ]);

  if (baselineError) {
    throw new Error(`Failed to load baseline rows for totals: ${baselineError.message}`);
  }

  if (mappingError) {
    throw new Error(`Failed to load mappings for totals: ${mappingError.message}`);
  }

  const totalsByMechanic = new Map<string, { quarters: number; hours: number; targetHours: number }>();

  for (const mapping of mappings ?? []) {
    totalsByMechanic.set(mapping.id as string, {
      quarters: 0,
      hours: 0,
      targetHours: Number(mapping.daily_target_hours ?? 8),
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

  const { error } = await supabase.from("daily_mechanic_totals").upsert(upserts, {
    onConflict: "stat_date,mechanic_id",
  });

  if (error) {
    throw new Error(`Failed to upsert daily mechanic totals: ${error.message}`);
  }
}

export async function probeCustomersFirstTicketMaterials() {
  const client = new CustomersFirstClient();
  const page = await client.listTicketMaterialsPage({ paginationStart: 0 });

  return {
    rawItemCount: page.rawItems.length,
    normalizedItemCount: page.normalizedItems.length,
    nextStart: page.nextStart,
    sampleRawItem: page.rawItems[0] ?? null,
    sampleNormalizedItem: page.normalizedItems[0] ?? null,
  };
}

export async function runPhaseOneSync(mode: SyncMode): Promise<SyncResult> {
  const syncLogId = await createSyncLog(mode);

  try {
    const statDate = getCopenhagenDateString();
    const [mappings, todayRows] = await Promise.all([fetchActiveMappings(), loadTodayRows(statDate)]);
    const mappingByItemNo = new Map(mappings.map((mapping) => [mapping.mechanic_item_no.trim(), mapping]));
    const existingRowsByMaterialId = new Map(todayRows.map((row) => [row.ticket_material_id, row]));
    const client = new CustomersFirstClient();
    const allMaterials = await client.listAllTicketMaterials();
    const now = toIsoTimestamp();
    const unmappedProductNos = new Set<string>();
    const affectedMechanicIds = new Set<string>();
    const seenMaterialIds = new Set<number>();
    const visibilityAnomalies: number[] = [];
    let missingProductNoCount = 0;
    let rowsCorrected = 0;
    let anomalyCount = 0;
    let mappedMaterialsSeen = 0;

    const upserts = allMaterials.normalizedItems.flatMap((material) => {
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
      const existingRow = existingRowsByMaterialId.get(material.ticketMaterialId);
      const anomalyCode = buildBaselineAnomaly(existingRow, material, mode);

      if (anomalyCode !== null) {
        anomalyCount += 1;
        rowsCorrected += anomalyCode === "quantity_decreased" || anomalyCode === "below_baseline_correction" ? 1 : 0;
      }

      if (mode === "baseline" && existingRow) {
        return [];
      }

      const baselineQuantity = mode === "baseline"
        ? material.amount
        : existingRow
          ? Number(existingRow.baseline_quantity)
          : 0;
      const currentQuantity = material.amount;
      const todayAddedQuantity = mode === "baseline" ? 0 : currentQuantity - baselineQuantity;

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

    if (mode === "sync") {
      const invisibleRows = todayRows.filter((row) => !seenMaterialIds.has(row.ticket_material_id));
      if (invisibleRows.length > 0) {
        visibilityAnomalies.push(...invisibleRows.map((row) => row.ticket_material_id));
        anomalyCount += invisibleRows.length;

        const { error } = await supabase
          .from("daily_ticket_item_baselines")
          .update({
            anomaly_code: "missing_in_latest_fetch",
            updated_at: now,
          })
          .eq("stat_date", statDate)
          .in(
            "ticket_material_id",
            invisibleRows.map((row) => row.ticket_material_id),
          );

        if (error) {
          throw new Error(`Failed to flag visibility anomalies: ${error.message}`);
        }
      }
    }

    await recalculateTotals(statDate, [...affectedMechanicIds]);

    const result: SyncResult = {
      syncLogId,
      mode,
      statDate,
      httpCalls: allMaterials.httpCalls,
      materialsSeen: allMaterials.normalizedItems.length,
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
      tickets_seen: new Set(allMaterials.normalizedItems.map((item) => item.ticketId)).size,
      materials_seen: result.materialsSeen,
      rows_upserted: result.rowsUpserted,
      rows_corrected: result.rowsCorrected,
      anomaly_count: result.anomalyCount,
      message: `${mode} completed`,
      details_json: result.details,
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

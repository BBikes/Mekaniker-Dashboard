/**
 * Saves sync results to Supabase.
 * Uses UPSERT so re-running is always safe and idempotent.
 */

import { createAdminClient } from "@/lib/supabase/server";
import type { SyncResult } from "./bikedesk";

export async function saveSyncResult(result: SyncResult): Promise<void> {
  const db = createAdminClient();

  // Upsert daily_totals for each mechanic — includes ticket_ids
  const rows = Object.entries(result.mechanicTotals).map(([mechanic_id, quarters]) => ({
    mechanic_id,
    work_date: result.syncDate,
    quarters: Math.round(quarters),
    ticket_ids: result.mechanicTicketIds[mechanic_id] ?? [],
    synced_at: new Date().toISOString(),
  }));

  if (rows.length > 0) {
    const { error } = await db
      .from("daily_totals")
      .upsert(rows, { onConflict: "mechanic_id,work_date" });

    if (error) {
      throw new Error(`Failed to upsert daily_totals: ${error.message}`);
    }
  }
}

export async function logSyncStart(): Promise<string> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("sync_log")
    .insert({ status: "running", started_at: new Date().toISOString() })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create sync log: ${error?.message}`);
  }

  return data.id as string;
}

export async function logSyncComplete(
  logId: string,
  result: SyncResult,
): Promise<void> {
  const db = createAdminClient();
  await db
    .from("sync_log")
    .update({
      status: "completed",
      finished_at: new Date().toISOString(),
      tickets_fetched: result.ticketsFetched,
      materials_processed: result.materialsProcessed,
    })
    .eq("id", logId);
}

export async function logSyncError(logId: string, error: unknown): Promise<void> {
  const db = createAdminClient();
  const message = error instanceof Error ? error.message : String(error);
  await db
    .from("sync_log")
    .update({
      status: "failed",
      finished_at: new Date().toISOString(),
      error_message: message,
    })
    .eq("id", logId);
}

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/server-auth";
import { getMechanics } from "@/lib/data/mechanics";
import { runDailySync } from "@/lib/sync/bikedesk";
import { saveSyncResult, logSyncStart, logSyncComplete, logSyncError } from "@/lib/sync/save";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const logId = await logSyncStart();

  try {
    const mechanics = await getMechanics(true);

    if (mechanics.length === 0) {
      await logSyncError(logId, new Error("No active mechanics configured"));
      return NextResponse.json({ error: "No active mechanics configured" }, { status: 400 });
    }

    const result = await runDailySync(mechanics);
    await saveSyncResult(result);
    await logSyncComplete(logId, result);

    return NextResponse.json({
      ok: true,
      syncDate: result.syncDate,
      ticketsFetched: result.ticketsFetched,
      materialsProcessed: result.materialsProcessed,
      mechanicTotals: result.mechanicTotals,
      durationMs: result.durationMs,
    });
  } catch (err) {
    await logSyncError(logId, err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

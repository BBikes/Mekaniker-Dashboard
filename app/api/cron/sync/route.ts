import { NextRequest, NextResponse } from "next/server";

import {
  aggregateScheduledMetrics,
  completeScheduledSyncRun,
  ensureHistoricalBackfill,
  runPhaseOneSync,
  startScheduledSyncRun,
} from "@/lib/sync/run-phase-one-sync";
import { isCronAuthorized } from "@/lib/supabase/server-auth";

export const runtime = "nodejs";

async function handleScheduledSync(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Ikke autoriseret." }, { status: 401 });
  }

  const scheduledRun = await startScheduledSyncRun();

  if (scheduledRun.skipped) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "another_sync_is_running",
      runningSyncLogId: scheduledRun.runningSyncLogId,
      runningSyncType: scheduledRun.runningSyncType,
      startedAt: scheduledRun.startedAt,
      lockWindowMinutes: scheduledRun.lockWindowMinutes,
    });
  }

  try {
    const backfill = await ensureHistoricalBackfill();
    const baseline = await runPhaseOneSync("baseline");
    const sync = await runPhaseOneSync("sync");
    const metrics = aggregateScheduledMetrics([backfill, baseline, sync]);

    await completeScheduledSyncRun(scheduledRun.syncLogId, {
      status: "completed",
      message: "scheduled sync completed",
      metrics,
      details: {
        backfillSyncLogId: backfill?.syncLogId ?? null,
        baselineSyncLogId: baseline.syncLogId,
        syncSyncLogId: sync.syncLogId,
      },
    });

    return NextResponse.json({
      ok: true,
      skipped: false,
      scheduledSyncLogId: scheduledRun.syncLogId,
      backfill,
      baseline,
      sync,
    });
  } catch (error) {
    await completeScheduledSyncRun(scheduledRun.syncLogId, {
      status: "failed",
      message: error instanceof Error ? error.message : "Ukendt scheduled sync-fejl",
      details: {},
    });

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Ukendt scheduled sync-fejl",
      },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return handleScheduledSync(request);
}

export async function POST(request: NextRequest) {
  return handleScheduledSync(request);
}

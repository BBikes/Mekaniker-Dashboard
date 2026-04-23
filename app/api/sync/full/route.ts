import { NextResponse } from "next/server";

import { toOperatorErrorMessage } from "@/lib/env";
import {
  aggregateScheduledMetrics,
  completeScheduledSyncRun,
  runPhaseOneSync,
  startScheduledSyncRun,
} from "@/lib/sync/run-phase-one-sync";
import { createUnauthorizedApiResponse, getCurrentUserOrNull } from "@/lib/supabase/server-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/sync/full
 *
 * Kører den fulde daglige sync-sekvens (baseline + sync) for den indloggede bruger.
 * Svarer til den automatiske cron-sync, men trigges manuelt fra kontrolpanelet.
 */
export async function POST() {
  const user = await getCurrentUserOrNull();
  if (!user) {
    return createUnauthorizedApiResponse();
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
    const baseline = await runPhaseOneSync("baseline");
    const sync = await runPhaseOneSync("sync", {
      materialLookbackHours: 48,
      useFilteredProductDiscovery: true,
    });
    const metrics = aggregateScheduledMetrics([baseline, sync]);

    await completeScheduledSyncRun(scheduledRun.syncLogId, {
      status: "completed",
      message: "manual full sync completed",
      metrics,
      details: {
        baselineSyncLogId: baseline.syncLogId,
        syncSyncLogId: sync.syncLogId,
      },
    });

    return NextResponse.json({
      ok: true,
      skipped: false,
      scheduledSyncLogId: scheduledRun.syncLogId,
      baseline,
      sync,
    });
  } catch (error) {
    await completeScheduledSyncRun(scheduledRun.syncLogId, {
      status: "failed",
      message: error instanceof Error ? error.message : "Ukendt full sync-fejl",
      details: {},
    });

    return NextResponse.json(
      {
        error: toOperatorErrorMessage(error, "Ukendt full sync-fejl."),
      },
      { status: 500 },
    );
  }
}

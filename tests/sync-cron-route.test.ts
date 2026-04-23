import { afterEach, describe, expect, it, vi } from "vitest";

function buildSyncResult(mode: "sync" | "baseline") {
  return {
    syncLogId: `${mode}-log-1`,
    mode,
    statDate: "2026-04-14",
    httpCalls: 0,
    materialsSeen: 0,
    mappedMaterialsSeen: 0,
    rowsUpserted: 0,
    rowsCorrected: 0,
    anomalyCount: 0,
    details: {
      unmappedProductNos: [],
      missingProductNoCount: 0,
      affectedMechanicIds: [],
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
}

type RouteMocks = {
  isCronAuthorized?: ReturnType<typeof vi.fn>;
  startScheduledSyncRun?: ReturnType<typeof vi.fn>;
  runPhaseOneSync?: ReturnType<typeof vi.fn>;
  aggregateScheduledMetrics?: ReturnType<typeof vi.fn>;
  completeScheduledSyncRun?: ReturnType<typeof vi.fn>;
};

async function loadRoute({
  isCronAuthorized = vi.fn(() => true),
  startScheduledSyncRun = vi.fn(async () => ({
    skipped: false as const,
    syncLogId: "scheduled-log-1",
    startedAt: "2026-04-14T10:00:00.000Z",
    lockWindowMinutes: 20,
  })),
  runPhaseOneSync = vi.fn(async (mode: "sync" | "baseline") => buildSyncResult(mode)),
  aggregateScheduledMetrics = vi.fn(() => ({
    httpCalls: 0,
    materialsSeen: 0,
    rowsUpserted: 0,
    rowsCorrected: 0,
    anomalyCount: 0,
  })),
  completeScheduledSyncRun = vi.fn(async () => undefined),
}: RouteMocks = {}) {
  vi.resetModules();
  vi.doMock("@/lib/supabase/server-auth", () => ({
    isCronAuthorized,
  }));
  vi.doMock("@/lib/sync/run-phase-one-sync", () => ({
    aggregateScheduledMetrics,
    completeScheduledSyncRun,
    runPhaseOneSync,
    startScheduledSyncRun,
  }));

  const route = await import("@/app/api/cron/sync/route");
  return {
    aggregateScheduledMetrics,
    completeScheduledSyncRun,
    isCronAuthorized,
    route,
    runPhaseOneSync,
    startScheduledSyncRun,
  };
}

afterEach(() => {
  vi.resetModules();
  vi.unmock("@/lib/supabase/server-auth");
  vi.unmock("@/lib/sync/run-phase-one-sync");
});

describe("scheduled sync route", () => {
  it("returns a skip response when another sync is already running", async () => {
    const { route, runPhaseOneSync, completeScheduledSyncRun } = await loadRoute({
      startScheduledSyncRun: vi.fn(async () => ({
        skipped: true as const,
        runningSyncLogId: "running-log-1",
        runningSyncType: "sync" as const,
        startedAt: "2026-04-14T10:00:00.000Z",
        lockWindowMinutes: 20,
      })),
    });

    const response = await route.POST(new Request("http://localhost/api/cron/sync", { method: "POST" }) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      skipped: true,
      runningSyncLogId: "running-log-1",
      runningSyncType: "sync",
    });
    expect(runPhaseOneSync).not.toHaveBeenCalled();
    expect(completeScheduledSyncRun).not.toHaveBeenCalled();
  });

  it("runs baseline before sync and completes the scheduled sync log", async () => {
    const runPhaseOneSync = vi.fn(async (mode: "sync" | "baseline") => buildSyncResult(mode));
    const aggregateScheduledMetrics = vi.fn(() => ({
      httpCalls: 3,
      materialsSeen: 12,
      rowsUpserted: 4,
      rowsCorrected: 1,
      anomalyCount: 2,
    }));
    const completeScheduledSyncRun = vi.fn(async () => undefined);
    const { route } = await loadRoute({
      aggregateScheduledMetrics,
      completeScheduledSyncRun,
      runPhaseOneSync,
    });

    const response = await route.GET(new Request("http://localhost/api/cron/sync", { method: "GET" }) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      skipped: false,
      scheduledSyncLogId: "scheduled-log-1",
      baseline: { mode: "baseline" },
      sync: { mode: "sync" },
    });
    expect(runPhaseOneSync).toHaveBeenNthCalledWith(1, "baseline");
    expect(runPhaseOneSync).toHaveBeenNthCalledWith(2, "sync");
    expect(runPhaseOneSync.mock.invocationCallOrder[0]).toBeLessThan(runPhaseOneSync.mock.invocationCallOrder[1]);
    expect(aggregateScheduledMetrics).toHaveBeenCalledWith([
      expect.objectContaining({ mode: "baseline" }),
      expect.objectContaining({ mode: "sync" }),
    ]);
    expect(completeScheduledSyncRun).toHaveBeenCalledWith(
      "scheduled-log-1",
      expect.objectContaining({
        status: "completed",
        message: "scheduled sync completed",
        details: {
          baselineSyncLogId: "baseline-log-1",
          syncSyncLogId: "sync-log-1",
        },
      }),
    );
  });
});

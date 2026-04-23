import { afterEach, describe, expect, it, vi } from "vitest";

function buildSyncResult(mode: "sync" | "baseline" | "payments_backfill") {
  return {
    syncLogId: "sync-log-1",
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
    },
    payment: null,
  };
}

async function loadRoute(runPhaseOneSync = vi.fn(async () => buildSyncResult("payments_backfill"))) {
  vi.resetModules();
  vi.doMock("@/lib/env", () => ({
    toOperatorErrorMessage: (error: unknown, fallback = "Ukendt fejl.") =>
      error instanceof Error ? error.message : fallback,
  }));
  vi.doMock("@/lib/sync/run-phase-one-sync", () => ({
    runPhaseOneSync,
  }));
  vi.doMock("@/lib/supabase/server-auth", () => ({
    getCurrentUserOrNull: async () => ({ id: "user-1" }),
    createUnauthorizedApiResponse: () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
  }));

  const route = await import("@/app/api/sync/manual/route");
  return { route, runPhaseOneSync };
}

afterEach(() => {
  vi.resetModules();
  vi.unmock("@/lib/env");
  vi.unmock("@/lib/sync/run-phase-one-sync");
  vi.unmock("@/lib/supabase/server-auth");
});

describe("POST /api/sync/manual", () => {
  it("uses a latest snapshot sync by default", async () => {
    const runPhaseOneSync = vi.fn(async () => buildSyncResult("sync"));
    const { route } = await loadRoute(runPhaseOneSync);

    const response = await route.POST(
      new Request("http://localhost/api/sync/manual", {
        method: "POST",
        body: JSON.stringify({ mode: "sync" }),
        headers: { "content-type": "application/json" },
      }) as never,
    );

    expect(response.status).toBe(200);
    expect(runPhaseOneSync).toHaveBeenCalledWith("sync", {
      paymentBackfillDays: undefined,
      skipCykelPlusSync: true,
      skipPaymentSync: true,
      useFilteredProductDiscovery: true,
      materialLookbackHours: 48,
    });
  });

  it("uses payments_backfill with the default 7 day window", async () => {
    const runPhaseOneSync = vi.fn(async () => buildSyncResult("payments_backfill"));
    const { route } = await loadRoute(runPhaseOneSync);

    const response = await route.POST(
      new Request("http://localhost/api/sync/manual", {
        method: "POST",
        body: JSON.stringify({ mode: "payments_backfill" }),
        headers: { "content-type": "application/json" },
      }) as never,
    );

    expect(response.status).toBe(200);
    expect(runPhaseOneSync).toHaveBeenCalledWith("payments_backfill", { paymentBackfillDays: 7 });
  });
});

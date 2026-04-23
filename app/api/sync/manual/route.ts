import { NextRequest, NextResponse } from "next/server";

import { toOperatorErrorMessage } from "@/lib/env";
import { runPhaseOneSync, type SyncMode } from "@/lib/sync/run-phase-one-sync";
import { createUnauthorizedApiResponse, getCurrentUserOrNull } from "@/lib/supabase/server-auth";

export const runtime = "nodejs";
export const maxDuration = 300;
const DEFAULT_SYNC_LOOKBACK_HOURS = 48;

type RequestPayload = {
  lookbackHours?: number;
  mode?: SyncMode;
  days?: number;
};

export async function POST(request: NextRequest) {
  const user = await getCurrentUserOrNull();
  if (!user) {
    return createUnauthorizedApiResponse();
  }

  try {
    const payload = (await request.json()) as RequestPayload;
    const mode: SyncMode =
      payload.mode === "baseline"
        ? "baseline"
        : payload.mode === "payments_backfill"
          ? "payments_backfill"
          : "sync";
    const days =
      typeof payload.days === "number" && Number.isFinite(payload.days)
        ? Math.max(1, Math.trunc(payload.days))
        : undefined;
    const lookbackHours =
      typeof payload.lookbackHours === "number" && Number.isFinite(payload.lookbackHours)
        ? Math.max(1, Math.trunc(payload.lookbackHours))
        : DEFAULT_SYNC_LOOKBACK_HOURS;
    const paymentBackfillDays = mode === "payments_backfill" ? (days ?? 7) : days;
    const syncOptions =
      mode === "sync"
        ? {
            materialLookbackHours: lookbackHours,
            skipCykelPlusSync: true,
            skipPaymentSync: true,
            useFilteredProductDiscovery: false,
          }
        : {};
    const result = await runPhaseOneSync(mode, {
      paymentBackfillDays,
      ...syncOptions,
    });

    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json(
      {
        error: toOperatorErrorMessage(error, "Ukendt sync-fejl."),
      },
      { status: 500 },
    );
  }
}

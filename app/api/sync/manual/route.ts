import { NextRequest, NextResponse } from "next/server";

import { toOperatorErrorMessage } from "@/lib/env";
import { runPhaseOneSync, type SyncMode } from "@/lib/sync/run-phase-one-sync";
import { createUnauthorizedApiResponse, getCurrentUserOrNull } from "@/lib/supabase/server-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

type RequestPayload = {
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
    const paymentBackfillDays = mode === "payments_backfill" ? (days ?? 7) : days;
    const result = await runPhaseOneSync(mode, { paymentBackfillDays });

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

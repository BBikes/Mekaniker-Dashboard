import { NextRequest, NextResponse } from "next/server";

import { toOperatorErrorMessage } from "@/lib/env";
import { ensureHistoricalBackfill, runPhaseOneSync, type SyncMode } from "@/lib/sync/run-phase-one-sync";
import { createUnauthorizedApiResponse, getCurrentUserOrNull } from "@/lib/supabase/server-auth";

export const runtime = "nodejs";

type RequestPayload = {
  mode?: SyncMode;
};

export async function POST(request: NextRequest) {
  const user = await getCurrentUserOrNull();
  if (!user) {
    return createUnauthorizedApiResponse();
  }

  try {
    const payload = (await request.json()) as RequestPayload;
    const mode: SyncMode = payload.mode === "baseline" ? "baseline" : "sync";
    const backfill = mode === "sync" ? await ensureHistoricalBackfill() : null;
    const result = await runPhaseOneSync(mode);

    return NextResponse.json({
      backfill,
      result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: toOperatorErrorMessage(error, "Ukendt sync-fejl."),
      },
      { status: 500 },
    );
  }
}

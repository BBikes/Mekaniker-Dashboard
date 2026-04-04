import { NextRequest, NextResponse } from "next/server";

import { runPhaseOneSync, type SyncMode } from "@/lib/sync/run-phase-one-sync";

export const runtime = "nodejs";

type RequestPayload = {
  mode?: SyncMode;
};

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as RequestPayload;
    const mode: SyncMode = payload.mode === "baseline" ? "baseline" : "sync";
    const result = await runPhaseOneSync(mode);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown sync failure",
      },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";

import { ensureHistoricalBackfill, runPhaseOneSync } from "@/lib/sync/run-phase-one-sync";
import { isCronAuthorized } from "@/lib/supabase/server-auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Ikke autoriseret." }, { status: 401 });
  }

  try {
    const backfill = await ensureHistoricalBackfill();
    const baseline = await runPhaseOneSync("baseline");
    const sync = await runPhaseOneSync("sync");

    return NextResponse.json({
      ok: true,
      backfill,
      baseline,
      sync,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Ukendt cron-fejl",
      },
      { status: 500 },
    );
  }
}

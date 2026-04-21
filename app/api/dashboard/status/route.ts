import { NextResponse } from "next/server";

import { getDashboardAnomalySummary, getDashboardPresentation } from "@/lib/data/dashboard";
import { createUnauthorizedApiResponse, getCurrentUserOrNull } from "@/lib/supabase/server-auth";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUserOrNull();
  if (!user) {
    return createUnauthorizedApiResponse();
  }

  const [dashboard, anomalies] = await Promise.all([getDashboardPresentation(), getDashboardAnomalySummary()]);

  return NextResponse.json(
    {
      refreshToken: dashboard.refreshToken,
      latestSync: dashboard.latestSync,
      anomalies: {
        hasIssues: anomalies.hasIssues,
        totalMissingRows: anomalies.totalMissingRows,
        affectedMechanics: anomalies.affectedMechanics,
        latestSyncFinishedAt: anomalies.latestSyncFinishedAt,
      },
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}

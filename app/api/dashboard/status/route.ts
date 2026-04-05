import { NextResponse } from "next/server";

import { getLatestDashboardSync } from "@/lib/data/dashboard";
import { createUnauthorizedApiResponse, getCurrentUserOrNull } from "@/lib/supabase/server-auth";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUserOrNull();
  if (!user) {
    return createUnauthorizedApiResponse();
  }

  const latestSync = await getLatestDashboardSync();

  return NextResponse.json(
    {
      latestSync,
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}

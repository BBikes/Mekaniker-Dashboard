import { NextResponse } from "next/server";

import { getDashboardPresentation } from "@/lib/data/dashboard";
import { createUnauthorizedApiResponse, getCurrentUserOrNull } from "@/lib/supabase/server-auth";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUserOrNull();
  if (!user) {
    return createUnauthorizedApiResponse();
  }

  const dashboard = await getDashboardPresentation();

  return NextResponse.json(
    {
      refreshToken: dashboard.refreshToken,
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}

import { NextRequest } from "next/server";

import { buildCsv, type ExportMode, type PeriodMode } from "@/lib/data/reports";
import { createUnauthorizedApiResponse, getCurrentUserOrNull } from "@/lib/supabase/server-auth";

export const runtime = "nodejs";

function readParam(searchParams: URLSearchParams, key: string, fallback: string) {
  const value = searchParams.get(key);
  return value && value.length > 0 ? value : fallback;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUserOrNull();
  if (!user) {
    return createUnauthorizedApiResponse();
  }

  const searchParams = request.nextUrl.searchParams;
  const fromDate = readParam(searchParams, "fromDate", "");
  const toDate = readParam(searchParams, "toDate", "");

  if (!fromDate || !toDate) {
    return new Response("Missing fromDate or toDate", { status: 400 });
  }

  const periodMode = readParam(searchParams, "periodMode", "daily") as PeriodMode;
  const exportMode = readParam(searchParams, "exportMode", "summary") as ExportMode;
  const mechanicId = searchParams.get("mechanicId") || undefined;
  const csv = await buildCsv({
    fromDate,
    toDate,
    periodMode,
    exportMode,
    mechanicId,
  });

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bbikes-${exportMode}-${fromDate}-to-${toDate}.csv"`,
    },
  });
}

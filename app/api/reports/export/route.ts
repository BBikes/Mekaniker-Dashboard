import { NextRequest } from "next/server";

import {
  buildCsv,
  getDetailedPage,
  type AdminDetailedFilters,
  type AdminStatus,
  type ExportMode,
  type PeriodMode,
  type SortDirection,
} from "@/lib/data/reports";
import { createUnauthorizedApiResponse, getCurrentUserOrNull } from "@/lib/supabase/server-auth";

export const runtime = "nodejs";

const MAX_EXPORT_ROWS = 100_000;

function readParam(searchParams: URLSearchParams, key: string) {
  const value = searchParams.get(key);
  return value && value.length > 0 ? value : undefined;
}

function parseMechanicIds(searchParams: URLSearchParams) {
  const repeated = searchParams.getAll("mechanicIds");
  const fallback = readParam(searchParams, "mechanicId");
  const rawValues = repeated.length > 0 ? repeated : fallback ? [fallback] : [];

  return [...new Set(rawValues.flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean))];
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.floor(parsed);
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUserOrNull();
  if (!user) {
    return createUnauthorizedApiResponse();
  }

  const searchParams = request.nextUrl.searchParams;
  const fromDate = readParam(searchParams, "fromDate");
  const toDate = readParam(searchParams, "toDate");

  if (!fromDate || !toDate) {
    return new Response("Missing fromDate or toDate", { status: 400 });
  }

  const periodModeValue = readParam(searchParams, "periodMode");
  const periodMode: PeriodMode =
    periodModeValue === "weekly_avg" || periodModeValue === "monthly_avg" || periodModeValue === "daily"
      ? periodModeValue
      : "daily";
  const viewValue = readParam(searchParams, "view") ?? readParam(searchParams, "exportMode");
  const exportMode: ExportMode = viewValue === "detailed" ? "detailed" : "summary";
  const statusValue = readParam(searchParams, "status");
  const status: AdminStatus =
    statusValue === "paid" || statusValue === "open" || statusValue === "anomaly" || statusValue === "all"
      ? statusValue
      : "all";
  const dirValue = readParam(searchParams, "dir");
  const dir: SortDirection = dirValue === "asc" || dirValue === "desc" ? dirValue : exportMode === "summary" ? "desc" : "desc";
  const filters: AdminDetailedFilters & { exportMode: ExportMode } = {
    dir,
    exportMode,
    fromDate,
    mechanicIds: parseMechanicIds(searchParams),
    page: 1,
    pageSize: 1,
    periodMode,
    q: readParam(searchParams, "q") ?? undefined,
    sort: readParam(searchParams, "sort") ?? undefined,
    status,
    toDate,
  };

  if (exportMode === "detailed") {
    const preview = await getDetailedPage(filters);
    if (preview.total > MAX_EXPORT_ROWS) {
      return new Response(`Export exceeds the ${MAX_EXPORT_ROWS} row safety limit. Narrow the filters and try again.`, {
        status: 413,
      });
    }
  }

  const csv = await buildCsv(filters);

  return new Response(csv, {
    headers: {
      "Content-Disposition": `attachment; filename="b-bikes-${exportMode}-${fromDate}_til_${toDate}.csv"`,
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}

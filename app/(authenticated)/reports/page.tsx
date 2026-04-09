import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { CalendarYearOverview } from "@/app/(authenticated)/reports/calendar-year-overview";
import { FilterBar } from "@/app/(authenticated)/reports/filter-bar";
import { KpiRow } from "@/app/(authenticated)/reports/kpi-row";
import { SummaryTable } from "@/app/(authenticated)/reports/summary-table";
import {
  getActiveMechanics,
  getAdminSummary,
  getCalendarYearOverview,
  getKpiSnapshot,
  type AdminFilters,
  type PeriodMode,
  type SortDirection,
} from "@/lib/data/reports";
import { getDashboardReadinessMessage, getEnvPresence, toOperatorErrorMessage } from "@/lib/env";
import { getCopenhagenDateString } from "@/lib/time";

export const dynamic = "force-dynamic";

type SearchParamsValue = string | string[] | undefined;

type ReportsSearchParams = Record<string, SearchParamsValue>;

type ReportsPageFilters = {
  dir: SortDirection;
  fromDate: string;
  mechanicIds: string[];
  periodMode: PeriodMode;
  q: string;
  sort: string;
  toDate: string;
};

const SUMMARY_SORTS = new Set(["mechanic", "quarters", "hours", "target", "variance", "pct", "tickets", "avgDay", "avgTicket"]);

function readFirstParam(value: SearchParamsValue): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return typeof value === "string" ? value : undefined;
}

function readManyParams(value: SearchParamsValue): string[] {
  if (Array.isArray(value)) {
    return value;
  }

  return typeof value === "string" ? [value] : [];
}

function parseMechanicIds(params: ReportsSearchParams): string[] {
  const repeated = readManyParams(params.mechanicIds);
  const fallback = readFirstParam(params.mechanicId);
  const rawValues = repeated.length > 0 ? repeated : fallback ? [fallback] : [];

  return [...new Set(rawValues.flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean))];
}

function getDefaultDirection(sort: string): SortDirection {
  return sort === "mechanic" ? "asc" : "desc";
}

function parseFilters(params: ReportsSearchParams): ReportsPageFilters {
  const today = getCopenhagenDateString();
  const fromDate = readFirstParam(params.fromDate) ?? today;
  const toDate = readFirstParam(params.toDate) ?? today;
  const periodModeValue = readFirstParam(params.periodMode);
  const periodMode: PeriodMode =
    periodModeValue === "weekly_avg" || periodModeValue === "monthly_avg" || periodModeValue === "daily"
      ? periodModeValue
      : "daily";
  const mechanicIds = parseMechanicIds(params);
  const q = readFirstParam(params.q)?.trim() ?? "";
  const sortValue = readFirstParam(params.sort);
  const sort = sortValue && SUMMARY_SORTS.has(sortValue) ? sortValue : "hours";
  const dirValue = readFirstParam(params.dir);
  const dir = dirValue === "asc" || dirValue === "desc" ? dirValue : getDefaultDirection(sort);

  return {
    dir,
    fromDate,
    mechanicIds,
    periodMode,
    q,
    sort,
    toDate,
  };
}

function buildReportsHref(filters: ReportsPageFilters, overrides: Partial<ReportsPageFilters> = {}) {
  const next = {
    ...filters,
    ...overrides,
  };
  const params = new URLSearchParams({
    fromDate: next.fromDate,
    toDate: next.toDate,
    periodMode: next.periodMode,
    sort: next.sort,
    dir: next.dir,
  });

  if (next.mechanicIds.length > 0) {
    params.set("mechanicIds", next.mechanicIds.join(","));
  }

  if (next.q) {
    params.set("q", next.q);
  }

  return `/reports?${params.toString()}`;
}

function buildExportHref(filters: ReportsPageFilters, overrides: Partial<ReportsPageFilters> = {}) {
  const next = {
    ...filters,
    ...overrides,
  };
  const params = new URLSearchParams({
    fromDate: next.fromDate,
    toDate: next.toDate,
    periodMode: next.periodMode,
    sort: next.sort,
    dir: next.dir,
  });

  if (next.mechanicIds.length > 0) {
    params.set("mechanicIds", next.mechanicIds.join(","));
  }

  if (next.q) {
    params.set("q", next.q);
  }

  return `/api/reports/export?${params.toString()}`;
}

function getQuickPresets() {
  const today = getCopenhagenDateString();
  const current = new Date(`${today}T12:00:00Z`);
  const yesterday = new Date(current);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  const monday = new Date(current);
  const day = (monday.getUTCDay() + 6) % 7;
  monday.setUTCDate(monday.getUTCDate() - day);

  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);

  const lastWeekStart = new Date(monday);
  lastWeekStart.setUTCDate(lastWeekStart.getUTCDate() - 7);

  const lastWeekEnd = new Date(monday);
  lastWeekEnd.setUTCDate(lastWeekEnd.getUTCDate() - 1);

  const firstOfMonth = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1));
  const lastOfMonth = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0));
  const firstOfPreviousMonth = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 1, 1));
  const lastOfPreviousMonth = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 0));

  const lastThirtyStart = new Date(current);
  lastThirtyStart.setUTCDate(lastThirtyStart.getUTCDate() - 29);

  const toIsoDate = (value: Date) => value.toISOString().slice(0, 10);

  return [
    { label: "I dag", from: today, to: today },
    { label: "I går", from: toIsoDate(yesterday), to: toIsoDate(yesterday) },
    { label: "Denne uge", from: toIsoDate(monday), to: toIsoDate(sunday) },
    { label: "Sidste uge", from: toIsoDate(lastWeekStart), to: toIsoDate(lastWeekEnd) },
    { label: "Denne måned", from: toIsoDate(firstOfMonth), to: toIsoDate(lastOfMonth) },
    { label: "Sidste måned", from: toIsoDate(firstOfPreviousMonth), to: toIsoDate(lastOfPreviousMonth) },
    { label: "Sidste 30 dage", from: toIsoDate(lastThirtyStart), to: today },
  ];
}

function toAdminFilters(filters: ReportsPageFilters): AdminFilters {
  return {
    dir: filters.dir,
    fromDate: filters.fromDate,
    mechanicIds: filters.mechanicIds,
    periodMode: filters.periodMode,
    q: filters.q,
    sort: filters.sort,
    toDate: filters.toDate,
  };
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<ReportsSearchParams>;
}) {
  const env = getEnvPresence();

  if (!env.dashboardReady) {
    return (
      <>
        <AppHeader activeHref="/reports" />
        <main className="page-shell">
          <section className="panel">
            <p className="eyebrow">Rapport utilgængelig</p>
            <h2>Serverdata er ikke klar</h2>
            <p className="muted">{getDashboardReadinessMessage(env) ?? "Supabase er ikke konfigureret korrekt."}</p>
            <p className="inline-links">
              <Link href="/">Tilbage til kontrolpanel</Link>
            </p>
          </section>
        </main>
      </>
    );
  }

  const filters = parseFilters(await searchParams);
  const presets = getQuickPresets().map((preset) => ({
    active: filters.fromDate === preset.from && filters.toDate === preset.to,
    href: buildReportsHref(filters, {
      fromDate: preset.from,
      toDate: preset.to,
    }),
    label: preset.label,
  }));
  const exportHref = buildExportHref(filters);

  try {
    const adminFilters = toAdminFilters(filters);
    const calendarYear = Number.parseInt(getCopenhagenDateString().slice(0, 4), 10);
    const [mechanics, kpis, rows, calendarYearRows] = await Promise.all([
      getActiveMechanics(),
      getKpiSnapshot(adminFilters),
      getAdminSummary(adminFilters),
      getCalendarYearOverview({ mechanicIds: adminFilters.mechanicIds }, calendarYear),
    ]);

    return (
      <>
        <AppHeader activeHref="/reports" />
        <main className="page-shell">
          <section className="hero">
            <div className="hero__top">
              <div>
                <p className="eyebrow">Rapportering</p>
                <h1>Admin-panel for værkstedsdata</h1>
              </div>
            </div>
            <p>Filtrér historik, gennemse performance pr. mekaniker og eksportér CSV uden at røre TV-dashboardet.</p>
          </section>

          <FilterBar exportHref={exportHref} filters={filters} mechanics={mechanics} presets={presets} resetHref="/reports" />
          <KpiRow kpis={kpis} />
          <SummaryTable filters={filters} rows={rows} />
          <CalendarYearOverview rows={calendarYearRows} year={calendarYear} />
        </main>
      </>
    );
  } catch (error) {
    return (
      <>
        <AppHeader activeHref="/reports" />
        <main className="page-shell">
          <section className="panel">
            <p className="eyebrow">Rapport utilgængelig</p>
            <h2>Kunne ikke hente rapportdata</h2>
            <p className="muted">{toOperatorErrorMessage(error)}</p>
            <p className="inline-links">
              <Link href="/">Tilbage til kontrolpanel</Link>
            </p>
          </section>
        </main>
      </>
    );
  }
}

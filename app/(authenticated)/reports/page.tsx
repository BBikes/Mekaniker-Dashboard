import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import {
  getActiveMechanics,
  getDetailedRows,
  getSummaryRows,
  type ExportMode,
  type PeriodMode,
  type ReportFilters,
} from "@/lib/data/reports";
import { getDashboardReadinessMessage, getEnvPresence, toOperatorErrorMessage } from "@/lib/env";
import {
  formatCopenhagenDateTime,
  formatDecimal,
  formatHours,
  formatPercent,
  formatShortCopenhagenDate,
  getCopenhagenDateString,
} from "@/lib/time";

export const dynamic = "force-dynamic";

function getDefaultFilters(params: Record<string, string | string[] | undefined>): ReportFilters {
  const today = getCopenhagenDateString();
  const fromDate = typeof params.fromDate === "string" ? params.fromDate : today;
  const toDate = typeof params.toDate === "string" ? params.toDate : today;
  const periodMode = typeof params.periodMode === "string" ? (params.periodMode as PeriodMode) : "daily";
  const exportMode = typeof params.exportMode === "string" ? (params.exportMode as ExportMode) : "summary";
  const mechanicId = typeof params.mechanicId === "string" && params.mechanicId.length > 0 ? params.mechanicId : undefined;

  return { fromDate, toDate, periodMode, exportMode, mechanicId };
}

function buildQuery(filters: ReportFilters) {
  const params = new URLSearchParams({
    fromDate: filters.fromDate,
    toDate: filters.toDate,
    periodMode: filters.periodMode,
    exportMode: filters.exportMode,
  });

  if (filters.mechanicId) {
    params.set("mechanicId", filters.mechanicId);
  }

  return params.toString();
}

function buildPresetHref(filters: ReportFilters, fromDate: string, toDate: string) {
  return `/reports?${buildQuery({ ...filters, fromDate, toDate })}`;
}

function buildExportHref(filters: ReportFilters) {
  return `/api/reports/export?${buildQuery(filters)}`;
}

function getQuickPresets() {
  const today = getCopenhagenDateString();
  const now = new Date(`${today}T12:00:00Z`);
  const monday = new Date(now);
  const day = (monday.getUTCDay() + 6) % 7;
  monday.setUTCDate(monday.getUTCDate() - day);

  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);

  const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  const firstOfPrevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const lastOfPrevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));

  const iso = (value: Date) => value.toISOString().slice(0, 10);

  return [
    { label: "I dag", from: today, to: today },
    { label: "Denne uge", from: iso(monday), to: iso(sunday) },
    { label: "Denne måned", from: iso(firstOfMonth), to: iso(lastOfMonth) },
    { label: "Sidste måned", from: iso(firstOfPrevMonth), to: iso(lastOfPrevMonth) },
  ];
}

function formatPeriodLabel(period: string, mode: PeriodMode) {
  return mode === "daily" ? formatShortCopenhagenDate(period) : period;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
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

  const params = await searchParams;
  const filters = getDefaultFilters(params);
  const presets = getQuickPresets();

  try {
    const [mechanics, summaryRows, detailedRows] = await Promise.all([
      getActiveMechanics(),
      getSummaryRows(filters),
      filters.exportMode === "detailed" ? getDetailedRows(filters) : Promise.resolve([]),
    ]);

    return (
      <>
        <AppHeader activeHref="/reports" />
        <main className="page-shell">
          <section className="hero">
            <div className="hero__top">
              <div>
                <p className="eyebrow">Rapportering</p>
                <h1>Rapporter og eksport</h1>
              </div>
            </div>
            <p>Filtrér data, gennemse tabellen og eksportér summeret eller detaljeret CSV til Excel.</p>
          </section>

          <section className="panel">
            <div className="chip-row">
              {presets.map((preset) => {
                const isActive = filters.fromDate === preset.from && filters.toDate === preset.to;

                return (
                  <Link
                    className={`chip${isActive ? " is-active" : ""}`}
                    href={buildPresetHref(filters, preset.from, preset.to)}
                    key={preset.label}
                  >
                    {preset.label}
                  </Link>
                );
              })}
            </div>

            <form method="GET">
              <div className="reports-toolbar">
                <div className="field">
                  <label htmlFor="fromDate">Fra</label>
                  <input defaultValue={filters.fromDate} id="fromDate" name="fromDate" type="date" />
                </div>
                <div className="field">
                  <label htmlFor="toDate">Til</label>
                  <input defaultValue={filters.toDate} id="toDate" name="toDate" type="date" />
                </div>
                <div className="field">
                  <label htmlFor="periodMode">Periode</label>
                  <select defaultValue={filters.periodMode} id="periodMode" name="periodMode">
                    <option value="daily">Dagligt</option>
                    <option value="weekly_avg">Ugentligt snit</option>
                    <option value="monthly_avg">Månedligt snit</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="exportMode">Visning</label>
                  <select defaultValue={filters.exportMode} id="exportMode" name="exportMode">
                    <option value="summary">Summeret</option>
                    <option value="detailed">Detaljeret</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="mechanicId">Mekaniker</label>
                  <select defaultValue={filters.mechanicId ?? ""} id="mechanicId" name="mechanicId">
                    <option value="">Alle mekanikere</option>
                    {mechanics.map((mechanic) => (
                      <option key={mechanic.id} value={mechanic.id}>
                        {mechanic.mechanicName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="toolbar-actions">
                <button className="button button--accent" type="submit">
                  Opdater
                </button>
                <Link className="button button--ghost" href={buildExportHref(filters)}>
                  Eksportér CSV
                </Link>
              </div>
            </form>

            <div className="table-wrap">
              {filters.exportMode === "summary" ? (
                <table>
                  <thead>
                    <tr>
                      <th>Periode</th>
                      <th>Mekaniker</th>
                      <th>Kvarterer</th>
                      <th>Timer</th>
                      <th>Mål</th>
                      <th>Opfyldelse</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summaryRows.length > 0 ? (
                      summaryRows.map((row) => {
                        const ratio = row.targetHours > 0 ? row.hours / row.targetHours : 0;
                        return (
                          <tr key={`${row.period}-${row.mechanicName}`}>
                            <td>{formatPeriodLabel(row.period, filters.periodMode)}</td>
                            <td>{row.mechanicName}</td>
                            <td>{formatDecimal(row.quarters)}</td>
                            <td>{formatHours(row.hours)}</td>
                            <td>{formatHours(row.targetHours)}</td>
                            <td>{formatPercent(ratio)}</td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={6}>Ingen data i det valgte tidsrum.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Dato</th>
                      <th>Mekaniker</th>
                      <th>Ticket</th>
                      <th>Linje-ID</th>
                      <th>Varenummer</th>
                      <th>Baseline</th>
                      <th>Aktuel</th>
                      <th>Tilføjet</th>
                      <th>Timer</th>
                      <th>Betaling</th>
                      <th>Opdateret</th>
                      <th>Anomali</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailedRows.length > 0 ? (
                      detailedRows.map((row) => (
                        <tr key={`${row.statDate}-${row.ticketMaterialId}`}>
                          <td>{formatShortCopenhagenDate(row.statDate)}</td>
                          <td>{row.mechanicName}</td>
                          <td>{row.ticketId}</td>
                          <td>{row.ticketMaterialId}</td>
                          <td>{row.mechanicItemNo}</td>
                          <td>{formatDecimal(row.baselineQuantity)}</td>
                          <td>{formatDecimal(row.currentQuantity)}</td>
                          <td>{formatDecimal(row.todayAddedQuantity)}</td>
                          <td>{formatHours(row.hours)}</td>
                          <td>{row.paymentId ?? "-"}</td>
                          <td>{formatCopenhagenDateTime(row.sourceUpdatedAt)}</td>
                          <td>{row.anomalyCode ?? "-"}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={12}>Ingen data i det valgte tidsrum.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </section>
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

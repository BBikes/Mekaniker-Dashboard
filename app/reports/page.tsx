import Link from "next/link";

import {
  getActiveMechanics,
  getDetailedRows,
  getSummaryRows,
  type ExportMode,
  type PeriodMode,
  type ReportFilters,
} from "@/lib/data/reports";
import { getEnvPresence } from "@/lib/env";
import { getCopenhagenDateString } from "@/lib/time";

export const dynamic = "force-dynamic";

function getDefaultFilters(params: Record<string, string | string[] | undefined>): ReportFilters {
  const today = getCopenhagenDateString();
  const fromDate = typeof params.fromDate === "string" ? params.fromDate : today;
  const toDate = typeof params.toDate === "string" ? params.toDate : today;
  const periodMode = typeof params.periodMode === "string" ? (params.periodMode as PeriodMode) : "daily";
  const exportMode = typeof params.exportMode === "string" ? (params.exportMode as ExportMode) : "summary";
  const mechanicId = typeof params.mechanicId === "string" && params.mechanicId.length > 0 ? params.mechanicId : undefined;

  return {
    fromDate,
    toDate,
    periodMode,
    exportMode,
    mechanicId,
  };
}

function buildExportHref(filters: ReportFilters) {
  const params = new URLSearchParams({
    fromDate: filters.fromDate,
    toDate: filters.toDate,
    periodMode: filters.periodMode,
    exportMode: filters.exportMode,
  });

  if (filters.mechanicId) {
    params.set("mechanicId", filters.mechanicId);
  }

  return `/api/reports/export?${params.toString()}`;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const env = getEnvPresence();

  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    return (
      <main className="page-shell">
        <section className="panel">
          <p className="eyebrow">Reports unavailable</p>
          <h2>Supabase is not configured</h2>
          <p className="muted">Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, then reload this page.</p>
          <p className="inline-links">
            <Link href="/">Back to controls</Link>
          </p>
        </section>
      </main>
    );
  }

  const resolvedSearchParams = await searchParams;
  const filters = getDefaultFilters(resolvedSearchParams);
  try {
    const [mechanics, summaryRows, detailedRows] = await Promise.all([
      getActiveMechanics(),
      getSummaryRows(filters),
      filters.exportMode === "detailed" ? getDetailedRows(filters) : Promise.resolve([]),
    ]);

    return (
      <main className="page-shell">
        <section className="hero">
          <div className="hero__top">
            <div>
              <p className="eyebrow">Internal reporting</p>
              <h1>Workshop reports and export</h1>
            </div>
            <div className="inline-links">
              <Link href="/">Controls</Link>
              <Link href="/dashboard">TV dashboard</Link>
            </div>
          </div>
          <p>Filter the read model, preview the result, and export summary or detailed CSV without a full BI layer.</p>
        </section>

        <section className="panel">
          <form method="GET">
            <div className="reports-toolbar">
              <div className="field">
                <label htmlFor="fromDate">From</label>
                <input defaultValue={filters.fromDate} id="fromDate" name="fromDate" type="date" />
              </div>
              <div className="field">
                <label htmlFor="toDate">To</label>
                <input defaultValue={filters.toDate} id="toDate" name="toDate" type="date" />
              </div>
              <div className="field">
                <label htmlFor="periodMode">Period mode</label>
                <select defaultValue={filters.periodMode} id="periodMode" name="periodMode">
                  <option value="daily">Daily</option>
                  <option value="weekly_avg">Weekly avg</option>
                  <option value="monthly_avg">Monthly avg</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="exportMode">Export mode</label>
                <select defaultValue={filters.exportMode} id="exportMode" name="exportMode">
                  <option value="summary">Summary</option>
                  <option value="detailed">Detailed</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="mechanicId">Mechanic</label>
                <select defaultValue={filters.mechanicId ?? ""} id="mechanicId" name="mechanicId">
                  <option value="">All mechanics</option>
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
                Apply filters
              </button>
              <Link className="button button--ghost" href={buildExportHref(filters)}>
                Export CSV
              </Link>
            </div>
          </form>

          <div className="table-wrap">
            {filters.exportMode === "summary" ? (
              <table>
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Mechanic</th>
                    <th>Quarters</th>
                    <th>Hours</th>
                    <th>Target</th>
                    <th>Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryRows.length > 0 ? (
                    summaryRows.map((row) => (
                      <tr key={`${row.period}-${row.mechanicName}`}>
                        <td>{row.period}</td>
                        <td>{row.mechanicName}</td>
                        <td>{row.quarters.toFixed(2)}</td>
                        <td>{row.hours.toFixed(2)}</td>
                        <td>{row.targetHours.toFixed(2)}</td>
                        <td>{row.varianceHours.toFixed(2)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6}>No summary data in the selected range.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Mechanic</th>
                    <th>Ticket</th>
                    <th>Material</th>
                    <th>Item no</th>
                    <th>Baseline</th>
                    <th>Current</th>
                    <th>Today added</th>
                    <th>Hours</th>
                    <th>Payment</th>
                    <th>Updated</th>
                    <th>Anomaly</th>
                  </tr>
                </thead>
                <tbody>
                  {detailedRows.length > 0 ? (
                    detailedRows.map((row) => (
                      <tr key={`${row.statDate}-${row.ticketMaterialId}`}>
                        <td>{row.statDate}</td>
                        <td>{row.mechanicName}</td>
                        <td>{row.ticketId}</td>
                        <td>{row.ticketMaterialId}</td>
                        <td>{row.mechanicItemNo}</td>
                        <td>{row.baselineQuantity.toFixed(2)}</td>
                        <td>{row.currentQuantity.toFixed(2)}</td>
                        <td>{row.todayAddedQuantity.toFixed(2)}</td>
                        <td>{row.hours.toFixed(2)}</td>
                        <td>{row.paymentId ?? "-"}</td>
                        <td>{row.sourceUpdatedAt ?? "-"}</td>
                        <td>{row.anomalyCode ?? "-"}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={12}>No detailed rows in the selected range.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </main>
    );
  } catch (error) {
    return (
      <main className="page-shell">
        <section className="panel">
          <p className="eyebrow">Reports unavailable</p>
          <h2>Could not load report data</h2>
          <p className="muted">{error instanceof Error ? error.message : "Unknown report error"}</p>
          <p className="inline-links">
            <Link href="/">Back to controls</Link>
          </p>
        </section>
      </main>
    );
  }
}

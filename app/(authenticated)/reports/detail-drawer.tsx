import Link from "next/link";

import type { ActiveMechanic, AdminStatus, ExportMode, PeriodMode, SortDirection } from "@/lib/data/reports";
import { getSummaryRows } from "@/lib/data/reports";
import { formatDecimal, formatHours, formatPercent, formatShortCopenhagenDate } from "@/lib/time";

type DrawerFilterState = {
  dir: SortDirection;
  drawerMechanicId?: string;
  fromDate: string;
  mechanicIds: string[];
  page: number;
  pageSize: number;
  periodMode: PeriodMode;
  q: string;
  sort: string;
  status: AdminStatus;
  toDate: string;
  view: ExportMode;
};

type DetailDrawerProps = {
  filters: DrawerFilterState;
  mechanics: ActiveMechanic[];
};

function buildReportsHref(filters: DrawerFilterState, overrides: Partial<DrawerFilterState> = {}) {
  const next = {
    ...filters,
    ...overrides,
  };
  const params = new URLSearchParams({
    fromDate: next.fromDate,
    toDate: next.toDate,
    periodMode: next.periodMode,
    view: next.view,
    sort: next.sort,
    dir: next.dir,
    page: String(next.page),
    pageSize: String(next.pageSize),
  });

  if (next.mechanicIds.length > 0) {
    params.set("mechanicIds", next.mechanicIds.join(","));
  }

  if (next.status !== "all") {
    params.set("status", next.status);
  }

  if (next.q) {
    params.set("q", next.q);
  }

  if (next.drawerMechanicId) {
    params.set("drawerMechanicId", next.drawerMechanicId);
  }

  return `/reports?${params.toString()}`;
}

export async function DetailDrawer({ filters, mechanics }: DetailDrawerProps) {
  if (!filters.drawerMechanicId) {
    return null;
  }

  const rows = await getSummaryRows({
    fromDate: filters.fromDate,
    toDate: filters.toDate,
    periodMode: "daily",
    exportMode: "summary",
    mechanicId: filters.drawerMechanicId,
  });
  const mechanicName =
    mechanics.find((mechanic) => mechanic.id === filters.drawerMechanicId)?.mechanicName ??
    rows[0]?.mechanicName ??
    "Ukendt mekaniker";
  const totalHours = rows.reduce((sum, row) => sum + row.hours, 0);
  const totalTarget = rows.reduce((sum, row) => sum + row.targetHours, 0);
  const fulfillmentPct = totalTarget > 0 ? totalHours / totalTarget : 0;
  const closeHref = buildReportsHref(filters, {
    drawerMechanicId: undefined,
  });
  const detailedHref = buildReportsHref(filters, {
    drawerMechanicId: undefined,
    mechanicIds: [filters.drawerMechanicId],
    page: 1,
    view: "detailed",
  });

  return (
    <>
      <Link aria-label="Luk detaljevisning" className="drawer__backdrop" href={closeHref} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <div className="drawer__body">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Mekaniker-detaljer</p>
              <h2 id="drawer-title">{mechanicName}</h2>
            </div>
            <Link className="button button--ghost" href={closeHref}>
              Luk
            </Link>
          </div>

          <p className="muted">
            {formatShortCopenhagenDate(filters.fromDate)} - {formatShortCopenhagenDate(filters.toDate)}
          </p>

          <div className="drawer__metrics">
            <article className="panel">
              <p className="eyebrow">Timer</p>
              <p className="metric">{formatHours(totalHours)}</p>
            </article>
            <article className="panel">
              <p className="eyebrow">Mål</p>
              <p className="metric">{formatHours(totalTarget)}</p>
            </article>
            <article className="panel">
              <p className="eyebrow">Opfyldelse</p>
              <p className={`metric${fulfillmentPct < 0.8 || fulfillmentPct > 1 ? " metric--alert" : ""}`}>
                {formatPercent(fulfillmentPct)}
              </p>
            </article>
          </div>

          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Dato</th>
                  <th>Kvarterer</th>
                  <th>Timer</th>
                  <th>Mål</th>
                  <th>Difference</th>
                </tr>
              </thead>
              <tbody>
                {rows.length > 0 ? (
                  rows.map((row) => (
                    <tr key={row.period}>
                      <td>{formatShortCopenhagenDate(row.period)}</td>
                      <td>{formatDecimal(row.quarters)}</td>
                      <td>{formatHours(row.hours)}</td>
                      <td>{formatHours(row.targetHours)}</td>
                      <td>{formatHours(row.varianceHours)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5}>Ingen daglige rækker i den valgte periode.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="inline-links">
            <Link href={detailedHref}>Se alle ticketlinjer</Link>
          </div>
        </div>
      </aside>
    </>
  );
}

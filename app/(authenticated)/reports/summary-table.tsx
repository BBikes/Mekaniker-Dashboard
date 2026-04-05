import Link from "next/link";

import type { AdminStatus, AdminSummaryRow, ExportMode, PeriodMode, SortDirection } from "@/lib/data/reports";
import { formatDecimal, formatHours, formatPercent } from "@/lib/time";

import { getFulfillmentStyle } from "./fulfillment-color";

type SummaryFilterState = {
  dir: SortDirection;
  drawerMechanicId?: string;
  fromDate: string;
  mechanicIds: string[];
  pageSize: number;
  periodMode: PeriodMode;
  q: string;
  sort: string;
  status: AdminStatus;
  toDate: string;
  view: ExportMode;
};

type SummaryTableProps = {
  filters: SummaryFilterState;
  rows: AdminSummaryRow[];
};

type SortKey = "mechanic" | "quarters" | "hours" | "target" | "variance" | "pct" | "tickets" | "avgDay" | "avgTicket";

function buildReportsHref(filters: SummaryFilterState, overrides: Partial<SummaryFilterState> = {}) {
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
    page: "1",
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

function getNextDirection(filters: SummaryFilterState, key: SortKey): SortDirection {
  if (filters.sort === key) {
    return filters.dir === "asc" ? "desc" : "asc";
  }

  return key === "mechanic" ? "asc" : "desc";
}

function SortHeader({
  filters,
  label,
  sortKey,
}: {
  filters: SummaryFilterState;
  label: string;
  sortKey: SortKey;
}) {
  const isActive = filters.sort === sortKey;
  const nextDir = getNextDirection(filters, sortKey);
  const href = buildReportsHref(filters, {
    dir: nextDir,
    drawerMechanicId: undefined,
    sort: sortKey,
  });

  return (
    <Link className={`sort-link${isActive ? " is-active" : ""}`} href={href}>
      <span>{label}</span>
      {isActive ? <span aria-hidden="true">{filters.dir === "asc" ? "▲" : "▼"}</span> : null}
    </Link>
  );
}

export function SummaryTable({ filters, rows }: SummaryTableProps) {
  return (
    <section className="panel admin-grid">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Summeret visning</p>
          <h2>Timer og målopfyldelse pr. mekaniker</h2>
        </div>
        <p className="muted">Klik på mekanikernavnet for at åbne dag-for-dag-detaljer i drawer&apos;en.</p>
      </div>

      <div className="table-shell">
        <div className="table-wrap table-wrap--reports">
          <table className="admin-table">
            <thead>
              <tr>
                <th>
                  <SortHeader filters={filters} label="Mekaniker" sortKey="mechanic" />
                </th>
                <th>
                  <SortHeader filters={filters} label="Kvarterer" sortKey="quarters" />
                </th>
                <th>
                  <SortHeader filters={filters} label="Timer" sortKey="hours" />
                </th>
                <th>
                  <SortHeader filters={filters} label="Mål (t)" sortKey="target" />
                </th>
                <th>
                  <SortHeader filters={filters} label="Difference (t)" sortKey="variance" />
                </th>
                <th>
                  <SortHeader filters={filters} label="Opfyldelse" sortKey="pct" />
                </th>
                <th>
                  <SortHeader filters={filters} label="Tickets" sortKey="tickets" />
                </th>
                <th>
                  <SortHeader filters={filters} label="Snit pr. dag" sortKey="avgDay" />
                </th>
                <th>
                  <SortHeader filters={filters} label="Snit pr. ticket" sortKey="avgTicket" />
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length > 0 ? (
                rows.map((row) => {
                  const drawerHref = buildReportsHref(filters, {
                    drawerMechanicId: row.mechanicId,
                  });

                  return (
                    <tr key={row.mechanicId}>
                      <td>
                        <Link className="table-link" href={drawerHref}>
                          {row.mechanicName}
                        </Link>
                      </td>
                      <td>{formatDecimal(row.quarters)}</td>
                      <td>{formatHours(row.hours)}</td>
                      <td>{formatHours(row.targetHours)}</td>
                      <td>{formatHours(row.varianceHours)}</td>
                      <td className="cell--fulfillment" style={getFulfillmentStyle(row.fulfillmentPct)}>
                        {formatPercent(row.fulfillmentPct)}
                      </td>
                      <td>{row.tickets}</td>
                      <td>{formatHours(row.avgHoursPerDay)}</td>
                      <td>{formatHours(row.avgHoursPerTicket)}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={9}>Ingen summerede data matcher de valgte filtre.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

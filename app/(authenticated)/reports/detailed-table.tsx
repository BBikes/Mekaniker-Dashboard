import Link from "next/link";

import type {
  AdminStatus,
  DetailedPage,
  ExportMode,
  PeriodMode,
  SortDirection,
} from "@/lib/data/reports";
import { formatCopenhagenTime, formatDecimal, formatHours, formatShortCopenhagenDate } from "@/lib/time";

type DetailedFilterState = {
  dir: SortDirection;
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

type DetailedTableProps = {
  filters: DetailedFilterState;
  pageData: DetailedPage;
};

type SortKey =
  | "date"
  | "mechanic"
  | "ticket"
  | "item"
  | "baseline"
  | "current"
  | "added"
  | "hours"
  | "paid"
  | "updated"
  | "anomaly";

function buildReportsHref(filters: DetailedFilterState, overrides: Partial<DetailedFilterState> = {}) {
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

  return `/reports?${params.toString()}`;
}

function buildExportHref(filters: DetailedFilterState, overrides: Partial<DetailedFilterState> = {}) {
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

  return `/api/reports/export?${params.toString()}`;
}

function getNextDirection(filters: DetailedFilterState, key: SortKey): SortDirection {
  if (filters.sort === key) {
    return filters.dir === "asc" ? "desc" : "asc";
  }

  if (key === "mechanic" || key === "item" || key === "ticket" || key === "anomaly") {
    return "asc";
  }

  return "desc";
}

function SortHeader({
  filters,
  label,
  sortKey,
}: {
  filters: DetailedFilterState;
  label: string;
  sortKey: SortKey;
}) {
  const isActive = filters.sort === sortKey;
  const href = buildReportsHref(filters, {
    dir: getNextDirection(filters, sortKey),
    page: 1,
    sort: sortKey,
  });

  return (
    <Link className={`sort-link${isActive ? " is-active" : ""}`} href={href}>
      <span>{label}</span>
      {isActive ? <span aria-hidden="true">{filters.dir === "asc" ? "▲" : "▼"}</span> : null}
    </Link>
  );
}

export function DetailedTable({ filters, pageData }: DetailedTableProps) {
  const { rows, total } = pageData;
  const start = total === 0 ? 0 : (filters.page - 1) * filters.pageSize + 1;
  const end = total === 0 ? 0 : start + rows.length - 1;
  const hasPreviousPage = filters.page > 1;
  const hasNextPage = filters.page * filters.pageSize < total;

  return (
    <section className="panel admin-grid">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Detaljeret visning</p>
          <h2>Ticketlinjer i perioden</h2>
        </div>
        <p className="muted">Status- og søgefiltre gælder kun de detaljerede rækker og CSV-eksporten.</p>
      </div>

      <div className="table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>
                <SortHeader filters={filters} label="Dato" sortKey="date" />
              </th>
              <th>
                <SortHeader filters={filters} label="Mekaniker" sortKey="mechanic" />
              </th>
              <th>
                <SortHeader filters={filters} label="Ticket-ID" sortKey="ticket" />
              </th>
              <th>
                <SortHeader filters={filters} label="Varenummer" sortKey="item" />
              </th>
              <th>
                <SortHeader filters={filters} label="Baseline (kv)" sortKey="baseline" />
              </th>
              <th>
                <SortHeader filters={filters} label="Aktuel (kv)" sortKey="current" />
              </th>
              <th>
                <SortHeader filters={filters} label="Tilføjet (kv)" sortKey="added" />
              </th>
              <th>
                <SortHeader filters={filters} label="Timer" sortKey="hours" />
              </th>
              <th>
                <SortHeader filters={filters} label="Låst" sortKey="paid" />
              </th>
              <th>
                <SortHeader filters={filters} label="Opdateret" sortKey="updated" />
              </th>
              <th>
                <SortHeader filters={filters} label="Anomali" sortKey="anomaly" />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? (
              rows.map((row) => (
                <tr key={`${row.statDate}-${row.ticketMaterialId}`}>
                  <td>{formatShortCopenhagenDate(row.statDate)}</td>
                  <td>{row.mechanicName}</td>
                  <td>{row.ticketId}</td>
                  <td>{row.mechanicItemNo}</td>
                  <td>{formatDecimal(row.baselineQuantity)}</td>
                  <td>{formatDecimal(row.currentQuantity)}</td>
                  <td>{formatDecimal(row.todayAddedQuantity)}</td>
                  <td>{formatHours(row.hours)}</td>
                  <td>{row.paymentId ? <span className="pill pill--paid">Betalt</span> : "-"}</td>
                  <td>{row.sourceUpdatedAt ? formatCopenhagenTime(row.sourceUpdatedAt) : "-"}</td>
                  <td>
                    {row.anomalyCode ? <span className="pill pill--anomaly">{row.anomalyCode}</span> : "-"}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={11}>Ingen detaljerede linjer matcher de valgte filtre.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        <p>
          Viser {start}-{end} af {total}
        </p>
        <div className="pagination__actions">
          {hasPreviousPage ? (
            <Link className="button button--ghost" href={buildReportsHref(filters, { page: filters.page - 1 })}>
              Forrige
            </Link>
          ) : (
            <span className="button button--ghost button--disabled">Forrige</span>
          )}

          {hasNextPage ? (
            <Link className="button button--ghost" href={buildReportsHref(filters, { page: filters.page + 1 })}>
              Næste
            </Link>
          ) : (
            <span className="button button--ghost button--disabled">Næste</span>
          )}
        </div>
      </div>

      <div className="inline-links">
        <Link href={buildExportHref(filters)}>Eksportér CSV</Link>
        <Link href={buildExportHref(filters, { status: "paid" })}>Eksportér kun låste linjer</Link>
        <Link href={buildExportHref(filters, { status: "anomaly" })}>Eksportér anomalier</Link>
      </div>
    </section>
  );
}

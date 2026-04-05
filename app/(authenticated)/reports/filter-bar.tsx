import Link from "next/link";

import type { ActiveMechanic, AdminStatus, ExportMode, PeriodMode, SortDirection } from "@/lib/data/reports";

type PresetLink = {
  active: boolean;
  href: string;
  label: string;
};

type FilterState = {
  dir: SortDirection;
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

type FilterBarProps = {
  exportHref: string;
  filters: FilterState;
  mechanics: ActiveMechanic[];
  presets: PresetLink[];
  resetHref: string;
};

export function FilterBar({ exportHref, filters, mechanics, presets, resetHref }: FilterBarProps) {
  return (
    <section className="panel admin-grid">
      <div className="chip-row">
        {presets.map((preset) => (
          <Link className={`chip${preset.active ? " is-active" : ""}`} href={preset.href} key={preset.label}>
            {preset.label}
          </Link>
        ))}
      </div>

      <form className="admin-filter-form" method="GET">
        <input name="sort" type="hidden" value={filters.sort} />
        <input name="dir" type="hidden" value={filters.dir} />
        <input name="page" type="hidden" value="1" />
        <input name="pageSize" type="hidden" value={String(filters.pageSize)} />
        {filters.view === "summary" ? <input name="status" type="hidden" value={filters.status} /> : null}

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
            <label htmlFor="view">Visning</label>
            <select defaultValue={filters.view} id="view" name="view">
              <option value="summary">Summeret</option>
              <option value="detailed">Detaljeret</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="mechanicIds">Mekaniker</label>
            <select defaultValue={filters.mechanicIds} id="mechanicIds" multiple name="mechanicIds" size={5}>
              {mechanics.map((mechanic) => (
                <option key={mechanic.id} value={mechanic.id}>
                  {mechanic.mechanicName}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="status">Status</label>
            <select
              defaultValue={filters.status}
              disabled={filters.view === "summary"}
              id="status"
              name="status"
              title={filters.view === "summary" ? "Status gælder kun detaljeret visning" : undefined}
            >
              <option value="all">Alle</option>
              <option value="paid">Betalt og låst</option>
              <option value="open">Åben</option>
              <option value="anomaly">Anomalier</option>
            </select>
          </div>

          <div className="field field--search">
            <label htmlFor="q">Søgning</label>
            <input
              defaultValue={filters.q}
              id="q"
              name="q"
              placeholder="Søg mekaniker, ticket-ID eller varenummer"
              type="search"
            />
          </div>
        </div>

        <div className="toolbar-actions">
          <button className="button button--accent" type="submit">
            Opdater
          </button>
          <Link className="button button--ghost" href={resetHref}>
            Nulstil filtre
          </Link>
          <Link className="button button--ghost" href={exportHref}>
            Eksportér CSV
          </Link>
        </div>
      </form>
    </section>
  );
}

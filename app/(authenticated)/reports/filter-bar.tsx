import Link from "next/link";

import type { ActiveMechanic, PeriodMode, SortDirection } from "@/lib/data/reports";

type PresetLink = {
  active: boolean;
  href: string;
  label: string;
};

type FilterState = {
  dir: SortDirection;
  fromDate: string;
  mechanicIds: string[];
  periodMode: PeriodMode;
  q: string;
  sort: string;
  toDate: string;
};

type FilterBarProps = {
  exportHref: string;
  filters: FilterState;
  mechanics: ActiveMechanic[];
  presets: PresetLink[];
  resetHref: string;
};

export function FilterBar({ exportHref, filters, mechanics, presets, resetHref }: FilterBarProps) {
  const selectedMechanics = mechanics.filter((mechanic) => filters.mechanicIds.includes(mechanic.id));
  const mechanicSummary =
    selectedMechanics.length === 0
      ? "Alle mekanikere"
      : selectedMechanics.length <= 2
        ? selectedMechanics.map((mechanic) => mechanic.mechanicName).join(", ")
        : `${selectedMechanics.length} mekanikere valgt`;

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
            <label>Mekaniker</label>
            <details className="dropdown-field">
              <summary className="dropdown-field__summary">{mechanicSummary}</summary>
              <div className="dropdown-field__menu">
                <div className="dropdown-field__list">
                  {mechanics.map((mechanic) => (
                    <label className="dropdown-option" key={mechanic.id}>
                      <input
                        defaultChecked={filters.mechanicIds.includes(mechanic.id)}
                        name="mechanicIds"
                        type="checkbox"
                        value={mechanic.id}
                      />
                      <span>{mechanic.mechanicName}</span>
                    </label>
                  ))}
                </div>
              </div>
            </details>
          </div>

          <div className="field field--search">
            <label htmlFor="q">Søgning</label>
            <input defaultValue={filters.q} id="q" name="q" placeholder="Søg mekaniker" type="search" />
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

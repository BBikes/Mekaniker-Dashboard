import type { CalendarYearOverviewRow } from "@/lib/data/reports";
import { formatDecimal } from "@/lib/time";

type CalendarYearOverviewProps = {
  rows: CalendarYearOverviewRow[];
  year: number;
};

export function CalendarYearOverview({ rows, year }: CalendarYearOverviewProps) {
  return (
    <section className="panel admin-grid">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Kalenderår</p>
          <h2>Månedlig oversigt for {year}</h2>
        </div>
      </div>

      <div className="table-shell">
        <div className="table-wrap table-wrap--reports">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Måned</th>
                <th>Mål (kv)</th>
                <th>Registreret (kv)</th>
                <th>Gns. pr. mekaniker (kv)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.monthKey}>
                  <td>{row.monthLabel}</td>
                  <td>{formatDecimal(row.targetQuarters)}</td>
                  <td>{formatDecimal(row.registeredQuarters)}</td>
                  <td>{formatDecimal(row.avgQuartersPerMechanic)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
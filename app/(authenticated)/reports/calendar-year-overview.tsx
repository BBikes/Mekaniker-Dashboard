import type { CalendarYearOverviewRow } from "@/lib/data/reports";
import { formatDecimal, formatHours, formatPercent } from "@/lib/time";

import { getFulfillmentStyle } from "./fulfillment-color";

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
                <th>Kvarterer</th>
                <th>Timer</th>
                <th>Mål (t)</th>
                <th>Difference (t)</th>
                <th>Opfyldelse</th>
                <th>Tickets</th>
                <th>Snit pr. dag</th>
                <th>Snit pr. ticket</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.monthKey}>
                  <td>{row.monthLabel}</td>
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
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
import type { KpiSnapshot } from "@/lib/data/reports";
import { formatDecimal, formatHours, formatInteger, formatPercent } from "@/lib/time";

import { getFulfillmentStyle } from "./fulfillment-color";

type KpiRowProps = {
  kpis: KpiSnapshot;
};

export function KpiRow({ kpis }: KpiRowProps) {
  return (
    <section className="panel-grid panel-grid--metrics">
      <article className="panel">
        <p className="eyebrow">Kvarterer (15 min)</p>
        <p className="metric">{formatDecimal(kpis.totalQuarters)}</p>
      </article>

      <article className="panel">
        <p className="eyebrow">Timer i perioden</p>
        <p className="metric">{formatHours(kpis.totalHours)}</p>
      </article>

      <article className="panel">
        <p className="eyebrow">Mål i perioden</p>
        <p className="metric">{formatHours(kpis.totalTarget)}</p>
      </article>

      <article className="panel">
        <p className="eyebrow">Opfyldelse</p>
        <p className="metric" style={getFulfillmentStyle(kpis.fulfillmentPct)}>
          {formatPercent(kpis.fulfillmentPct)}
        </p>
      </article>

      <article className="panel">
        <p className="eyebrow">Snit pr. mekaniker</p>
        <p className="metric">{formatHours(kpis.avgPerMechanic)}</p>
        <p className="muted">{formatInteger(kpis.mechanicsCount)} aktive i udtrækket</p>
      </article>

      <article className="panel">
        <p className="eyebrow">Snit pr. dag</p>
        <p className="metric">{formatHours(kpis.avgPerDay)}</p>
        <p className="muted">{formatInteger(kpis.workdaysCount)} arbejdsdage i perioden</p>
      </article>
    </section>
  );
}

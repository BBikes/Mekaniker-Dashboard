import type { KpiSnapshot } from "@/lib/data/reports";
import { formatDecimal, formatHours, formatInteger, formatPercent } from "@/lib/time";

type KpiRowProps = {
  kpis: KpiSnapshot;
};

export function KpiRow({ kpis }: KpiRowProps) {
  const fulfillmentAlert = kpis.fulfillmentPct < 0.8 || kpis.fulfillmentPct > 1;

  return (
    <section className="panel-grid panel-grid--metrics">
      <article className="panel">
        <p className="eyebrow">Timer i perioden</p>
        <p className="metric">{formatHours(kpis.totalHours)}</p>
      </article>

      <article className="panel">
        <p className="eyebrow">Kvarterer</p>
        <p className="metric">{formatDecimal(kpis.totalQuarters)}</p>
      </article>

      <article className="panel">
        <p className="eyebrow">Mål i perioden</p>
        <p className="metric">{formatHours(kpis.totalTarget)}</p>
      </article>

      <article className="panel">
        <p className="eyebrow">Opfyldelse</p>
        <p className={`metric${fulfillmentAlert ? " metric--alert" : ""}`}>{formatPercent(kpis.fulfillmentPct)}</p>
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

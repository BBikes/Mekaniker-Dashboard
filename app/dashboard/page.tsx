import { DashboardRefresh } from "@/components/dashboard-refresh";
import { getDashboardData } from "@/lib/data/dashboard";
import { getDashboardReadinessMessage, getEnvPresence, toOperatorErrorMessage } from "@/lib/env";
import { formatCopenhagenDate, formatCopenhagenTime, formatHours, getCopenhagenDateString } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const env = getEnvPresence();

  if (!env.dashboardReady) {
    return (
      <main className="dashboard-shell">
        <section className="dashboard-card">
          <header className="dashboard-header">
            <div>
              <p className="eyebrow">TV-visning utilgængelig</p>
              <h1>Serverdata er ikke klar</h1>
            </div>
          </header>
          <p className="muted">{getDashboardReadinessMessage(env) ?? "Supabase er ikke konfigureret korrekt."}</p>
        </section>
      </main>
    );
  }

  let dashboard: Awaited<ReturnType<typeof getDashboardData>>;

  try {
    dashboard = await getDashboardData();
  } catch (error) {
    return (
      <main className="dashboard-shell">
        <section className="dashboard-card">
          <header className="dashboard-header">
            <div>
              <p className="eyebrow">TV-visning utilgængelig</p>
              <h1>Kunne ikke hente dagens tal</h1>
            </div>
          </header>
          <p className="muted">{toOperatorErrorMessage(error)}</p>
        </section>
      </main>
    );
  }

  const chartCeiling = Math.max(8, ...dashboard.rows.map((row) => Math.max(row.hours, row.targetHours)));
  const targetRatio = (8 / chartCeiling) * 100;
  const todayLabel = formatCopenhagenDate(getCopenhagenDateString());
  const lastUpdatedLabel = dashboard.latestSync?.finishedAt
    ? formatCopenhagenTime(dashboard.latestSync.finishedAt)
    : "ikke synkroniseret endnu";

  return (
    <main className="dashboard-shell">
      <DashboardRefresh />
      <section className="dashboard-card">
        <header className="dashboard-header">
          <div>
            <p className="eyebrow">TV-visning</p>
            <h1>Dagens registrerede arbejdstid</h1>
          </div>
          <div className="dashboard-meta">
            <p>{todayLabel}</p>
            <p className="muted">Opdateres automatisk hvert 10. minut · Sidst opdateret {lastUpdatedLabel}</p>
          </div>
        </header>

        <section className="chart-shell">
          <div className="target-line" style={{ bottom: `${targetRatio}%` }}>
            <span>Mål 8,0 t</span>
          </div>
          <div className="bars">
            {dashboard.rows.length > 0 ? (
              dashboard.rows.map((row) => {
                const ratio = row.hours <= 0 ? 0 : Math.max((row.hours / chartCeiling) * 100, 4);

                return (
                  <article className="bar-card" key={row.id}>
                    <div className="bar-value">{formatHours(row.hours)}</div>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ height: `${ratio}%` }}>
                        {row.quarters > 0 ? `${row.quarters.toFixed(0)} kv` : ""}
                      </div>
                    </div>
                    <div className="bar-label">{row.mechanicName}</div>
                  </article>
                );
              })
            ) : (
              <p className="muted">Ingen registreringer endnu i dag.</p>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

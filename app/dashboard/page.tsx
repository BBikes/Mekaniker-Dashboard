import { DashboardRefresh } from "@/components/dashboard-refresh";
import { getDashboardData } from "@/lib/data/dashboard";
import { getDashboardReadinessMessage, getEnvPresence, toOperatorErrorMessage } from "@/lib/env";
import { formatCopenhagenDate, formatCopenhagenTime, formatHours, getCopenhagenDateString } from "@/lib/time";

export const dynamic = "force-dynamic";

const CHART_MAX_HOURS = 10;

function clampRatio(hours: number) {
  return Math.min(Math.max((hours / CHART_MAX_HOURS) * 100, 0), 100);
}

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

  const todayLabel = formatCopenhagenDate(getCopenhagenDateString());
  const lastUpdatedLabel = dashboard.latestSync?.finishedAt
    ? formatCopenhagenTime(dashboard.latestSync.finishedAt)
    : "ikke synkroniseret endnu";

  const defaultTargetHours = dashboard.rows[0]?.targetHours ?? 8;
  const uniformTargetHours = dashboard.rows.every((row) => Math.abs(row.targetHours - defaultTargetHours) < 0.001)
    ? defaultTargetHours
    : null;

  return (
    <main className="dashboard-shell">
      <DashboardRefresh initialRefreshToken={dashboard.latestSync?.refreshToken ?? null} />
      <section className="dashboard-card">
        <header className="dashboard-header">
          <div>
            <p className="eyebrow">TV-visning</p>
            <h1>Dagens registrerede arbejdstid</h1>
          </div>
          <div className="dashboard-meta">
            <p>{todayLabel}</p>
            <p className="muted">Opdaterer automatisk efter ny sync · Sidst opdateret {lastUpdatedLabel}</p>
          </div>
        </header>

        <section className="chart-shell">
          {uniformTargetHours !== null ? (
            <div className="target-line" style={{ bottom: `${clampRatio(uniformTargetHours)}%` }}>
              <span>Mål {formatHours(uniformTargetHours)}</span>
            </div>
          ) : null}

          <div className="bars">
            {dashboard.rows.length > 0 ? (
              dashboard.rows.map((row) => {
                const targetHours = Math.max(0, row.targetHours);
                const hours = Math.max(0, row.hours);
                const fillRatio = hours <= 0 ? 0 : Math.max(clampRatio(hours), 4);
                const targetRatio = clampRatio(targetHours);
                const isAtOrAboveTarget = hours >= targetHours;

                return (
                  <article className="bar-card" key={row.id}>
                    <div className="bar-value">{formatHours(row.hours)}</div>
                    <div className="bar-track">
                      {uniformTargetHours === null ? (
                        <div className="bar-target-line" style={{ bottom: `${targetRatio}%` }} />
                      ) : null}
                      <div
                        className={`bar-fill ${isAtOrAboveTarget ? "bar-fill--met" : "bar-fill--under"}`}
                        style={{ height: `${fillRatio}%` }}
                      >
                        {row.quarters > 0 ? `${row.quarters.toFixed(0)} kv` : ""}
                      </div>
                    </div>
                    <div className="bar-label">{row.mechanicName}</div>
                    {uniformTargetHours === null ? (
                      <div className="bar-target-copy">Mål {formatHours(targetHours)}</div>
                    ) : null}
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

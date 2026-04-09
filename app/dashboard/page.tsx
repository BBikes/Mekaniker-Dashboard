import { DashboardRotator } from "@/components/dashboard-rotator";
import { getDashboardPresentation } from "@/lib/data/dashboard";
import { getDashboardReadinessMessage, getEnvPresence, toOperatorErrorMessage } from "@/lib/env";
import { formatCopenhagenTime } from "@/lib/time";

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

  let dashboard: Awaited<ReturnType<typeof getDashboardPresentation>>;

  try {
    dashboard = await getDashboardPresentation();
  } catch (error) {
    return (
      <main className="dashboard-shell">
        <section className="dashboard-card">
          <header className="dashboard-header">
            <div>
              <p className="eyebrow">TV-visning utilgængelig</p>
              <h1>Kunne ikke hente dashboarddata</h1>
            </div>
          </header>
          <p className="muted">{toOperatorErrorMessage(error)}</p>
        </section>
      </main>
    );
  }

  const lastUpdatedLabel = dashboard.latestSync?.finishedAt
    ? formatCopenhagenTime(dashboard.latestSync.finishedAt)
    : "ikke synkroniseret endnu";

  return (
    <main className="dashboard-shell">
      <DashboardRotator
        boards={dashboard.boards}
        initialRefreshToken={dashboard.refreshToken}
        lastUpdatedLabel={lastUpdatedLabel}
      />
    </main>
  );
}

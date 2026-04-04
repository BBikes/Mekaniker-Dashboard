import Link from "next/link";

import { DashboardRefresh } from "@/components/dashboard-refresh";
import { getDashboardData } from "@/lib/data/dashboard";
import { getEnvPresence } from "@/lib/env";
import { formatCopenhagenTime, formatHours } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const env = getEnvPresence();

  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    return (
      <main className="page-shell">
        <section className="panel">
          <p className="eyebrow">Dashboard unavailable</p>
          <h2>Supabase is not configured</h2>
          <p className="muted">Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, then reload this page.</p>
          <p className="inline-links">
            <Link href="/">Back to controls</Link>
          </p>
        </section>
      </main>
    );
  }

  let dashboard: Awaited<ReturnType<typeof getDashboardData>>;

  try {
    dashboard = await getDashboardData();
  } catch (error) {
    return (
      <main className="page-shell">
        <section className="panel">
          <p className="eyebrow">Dashboard unavailable</p>
          <h2>Could not load daily totals</h2>
          <p className="muted">{error instanceof Error ? error.message : "Unknown dashboard error"}</p>
          <p className="inline-links">
            <Link href="/">Back to controls</Link>
          </p>
        </section>
      </main>
    );
  }

  const chartCeiling = Math.max(8, ...dashboard.rows.map((row) => Math.max(row.hours, row.targetHours)));
  const targetRatio = (8 / chartCeiling) * 100;

  return (
    <main className="dashboard-shell">
      <DashboardRefresh />
      <section className="dashboard-card">
        <header className="dashboard-header">
          <div>
            <p className="eyebrow">Workshop TV dashboard</p>
            <h1>Registered production today</h1>
          </div>
          <div className="dashboard-meta">
            <p>{dashboard.statDateLabel}</p>
            <p className="muted">
              Last updated{" "}
              {dashboard.latestSync?.finishedAt ? formatCopenhagenTime(dashboard.latestSync.finishedAt) : "not synced yet"}
            </p>
            <p className="muted">
              <Link href="/">Back to controls</Link>
            </p>
          </div>
        </header>

        <section className="chart-shell">
          <div className="target-line" style={{ bottom: `${targetRatio}%` }}>
            <span>Target 8.0 h</span>
          </div>
          <div className="bars">
            {dashboard.rows.map((row) => {
              const ratio = row.hours <= 0 ? 0 : Math.max((row.hours / chartCeiling) * 100, 4);

              return (
                <article className="bar-card" key={row.id}>
                  <div className="bar-value">{formatHours(row.hours)}</div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ height: `${ratio}%` }}>
                      {row.quarters > 0 ? `${row.quarters.toFixed(0)} q` : ""}
                    </div>
                  </div>
                  <div className="bar-label">{row.mechanicName}</div>
                </article>
              );
            })}
          </div>
        </section>
      </section>
    </main>
  );
}

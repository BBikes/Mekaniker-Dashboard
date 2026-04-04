import Link from "next/link";

import { InternalActions } from "@/components/internal-actions";
import { getDashboardData } from "@/lib/data/dashboard";
import { getActiveMechanics } from "@/lib/data/reports";
import { getEnvPresence } from "@/lib/env";
import { formatCopenhagenTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const env = getEnvPresence();
  let loadError: string | null = null;
  let mechanics: Awaited<ReturnType<typeof getActiveMechanics>> = [];
  let dashboard: Awaited<ReturnType<typeof getDashboardData>> = {
    statDate: "Not available",
    statDateLabel: "Not available",
    rows: [],
    latestSync: null,
  };

  if (env.supabaseUrl && env.supabaseServiceRoleKey) {
    try {
      [dashboard, mechanics] = await Promise.all([getDashboardData(), getActiveMechanics()]);
    } catch (error) {
      loadError = error instanceof Error ? error.message : "Failed to load Supabase data";
    }
  } else {
    loadError = "Add the Supabase environment variables to load internal data.";
  }

  const latestSyncLabel = dashboard.latestSync?.finishedAt
    ? `${dashboard.latestSync.status} at ${formatCopenhagenTime(dashboard.latestSync.finishedAt)}`
    : "No sync has finished yet";

  return (
    <main className="page-shell">
      <section className="hero">
        <div className="hero__top">
          <div>
            <p className="eyebrow">Internal module</p>
            <h1>B-Bikes workshop statistics</h1>
          </div>
          <div className="inline-links">
            <Link href="/dashboard">Open TV dashboard</Link>
            <Link href="/reports">Open reports</Link>
          </div>
        </div>
        <p>
          Phase 1 keeps the workflow explicit: verify the Customers 1st contract, seed today&apos;s baseline, and run
          manual syncs into Supabase.
        </p>
      </section>

      <section className="panel-grid">
        <article className="panel">
          <p className="eyebrow">Read model</p>
          <h2>Today</h2>
          <p className="metric">{dashboard.rows.reduce((sum, row) => sum + row.hours, 0).toFixed(2)} h</p>
          <p className="muted">Across {dashboard.rows.length} mechanics on {dashboard.statDate}</p>
        </article>
        <article className="panel">
          <p className="eyebrow">Mappings</p>
          <h2>Mechanics configured</h2>
          <p className="metric">{mechanics.length}</p>
          <p className="muted">Seed `mechanic_item_mapping` before syncing.</p>
        </article>
        <article className="panel">
          <p className="eyebrow">Latest sync</p>
          <h2>Status</h2>
          <p className="metric">{dashboard.latestSync?.status ?? "idle"}</p>
          <p className="muted">{latestSyncLabel}</p>
        </article>
      </section>

      {loadError ? (
        <section className="panel" style={{ marginBottom: 24 }}>
          <p className="eyebrow">Setup note</p>
          <h2>Data is not ready yet</h2>
          <p className="muted">{loadError}</p>
        </section>
      ) : null}

      <section className="panel-grid">
        <section className="panel">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Environment</p>
              <h2>Required secrets</h2>
            </div>
          </div>
          <div className="status-list">
            <div className="status-item">
              <span>SUPABASE_URL</span>
              <span className={`pill ${env.supabaseUrl ? "pill--ok" : "pill--missing"}`}>
                {env.supabaseUrl ? "Present" : "Missing"}
              </span>
            </div>
            <div className="status-item">
              <span>SUPABASE_SERVICE_ROLE_KEY</span>
              <span className={`pill ${env.supabaseServiceRoleKey ? "pill--ok" : "pill--missing"}`}>
                {env.supabaseServiceRoleKey ? "Present" : "Missing"}
              </span>
            </div>
            <div className="status-item">
              <span>C1ST_API_TOKEN</span>
              <span className={`pill ${env.c1stApiToken ? "pill--ok" : "pill--missing"}`}>
                {env.c1stApiToken ? "Present" : "Missing"}
              </span>
            </div>
          </div>
        </section>

        <section className="panel panel--link">
          <div className="panel__header">
            <div>
              <p className="eyebrow">TV view</p>
              <h2>Fullscreen bar chart</h2>
            </div>
          </div>
          <p className="muted">Large mechanic bars, 8.0 h target line, and a small last-updated marker.</p>
          <p className="inline-links">
            <Link href="/dashboard">Open dashboard</Link>
          </p>
        </section>

        <section className="panel panel--link">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Reporting</p>
              <h2>Table and CSV export</h2>
            </div>
          </div>
          <p className="muted">Daily, weekly average, monthly average, summary vs detailed, and CSV export.</p>
          <p className="inline-links">
            <Link href="/reports">Open reports</Link>
          </p>
        </section>
      </section>

      <InternalActions />
    </main>
  );
}

import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { InternalActions } from "@/components/internal-actions";
import { getDashboardData } from "@/lib/data/dashboard";
import { getActiveMechanics } from "@/lib/data/reports";
import { getEnvPresence } from "@/lib/env";
import { formatCopenhagenTime, formatHours } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const env = getEnvPresence();
  let loadError: string | null = null;
  let mechanics: Awaited<ReturnType<typeof getActiveMechanics>> = [];
  let dashboard: Awaited<ReturnType<typeof getDashboardData>> = {
    statDate: "ikke tilgængelig",
    statDateLabel: "ikke tilgængelig",
    rows: [],
    latestSync: null,
  };

  if (env.supabaseUrl && env.supabaseServiceRoleKey) {
    try {
      [dashboard, mechanics] = await Promise.all([getDashboardData(), getActiveMechanics()]);
    } catch (error) {
      loadError = error instanceof Error ? error.message : "Kunne ikke hente data fra Supabase.";
    }
  } else {
    loadError = "Tilføj Supabase-miljøvariablerne for at hente interne data.";
  }

  const totalHoursToday = dashboard.rows.reduce((sum, row) => sum + row.hours, 0);
  const latestSyncLabel = dashboard.latestSync?.finishedAt
    ? `${dashboard.latestSync.status} kl. ${formatCopenhagenTime(dashboard.latestSync.finishedAt)}`
    : "Ingen sync er kørt endnu";

  return (
    <>
      <AppHeader activeHref="/" />
      <main className="page-shell">
        <section className="hero">
          <div className="hero__top">
            <div>
              <p className="eyebrow">Intern app</p>
              <h1>Kontrolpanel</h1>
            </div>
            <div className="inline-links">
              <Link href="/dashboard" rel="noreferrer" target="_blank">
                Åbn TV-visning
              </Link>
              <Link href="/reports">Åbn rapporter</Link>
              <Link href="/settings">Åbn indstillinger</Link>
            </div>
          </div>
          <p>
            Herfra kan du åbne TV-dashboardet, gennemgå rapporter, vedligeholde mekanikere og køre manuel sync mod
            Customers 1st.
          </p>
        </section>

        <section className="panel-grid">
          <article className="panel">
            <p className="eyebrow">I dag</p>
            <h2>Registreret tid</h2>
            <p className="metric">{formatHours(totalHoursToday)}</p>
            <p className="muted">
              Fordelt på {dashboard.rows.length} mekanikere · {dashboard.statDateLabel}
            </p>
          </article>
          <article className="panel">
            <p className="eyebrow">Mekanikere</p>
            <h2>Konfigureret</h2>
            <p className="metric">{mechanics.length}</p>
            <p className="muted">Administreres under Indstillinger.</p>
          </article>
          <article className="panel">
            <p className="eyebrow">Seneste sync</p>
            <h2>Status</h2>
            <p className="metric">{dashboard.latestSync?.status ?? "ingen"}</p>
            <p className="muted">{latestSyncLabel}</p>
          </article>
        </section>

        {loadError ? (
          <section className="panel" style={{ marginBottom: 24 }}>
            <p className="eyebrow">Opsætning</p>
            <h2>Data er ikke klar endnu</h2>
            <p className="muted">{loadError}</p>
          </section>
        ) : null}

        <section className="panel-grid">
          <section className="panel">
            <div className="panel__header">
              <div>
                <p className="eyebrow">Miljø</p>
                <h2>Påkrævede nøgler</h2>
              </div>
            </div>
            <div className="status-list">
              <div className="status-item">
                <span>NEXT_PUBLIC_SUPABASE_URL</span>
                <span className={`pill ${env.supabaseUrl ? "pill--ok" : "pill--missing"}`}>
                  {env.supabaseUrl ? "Til stede" : "Mangler"}
                </span>
              </div>
              <div className="status-item">
                <span>NEXT_PUBLIC_SUPABASE_ANON_KEY</span>
                <span className={`pill ${env.supabaseAnonKey ? "pill--ok" : "pill--missing"}`}>
                  {env.supabaseAnonKey ? "Til stede" : "Mangler"}
                </span>
              </div>
              <div className="status-item">
                <span>SUPABASE_SERVICE_ROLE_KEY</span>
                <span className={`pill ${env.supabaseServiceRoleKey ? "pill--ok" : "pill--missing"}`}>
                  {env.supabaseServiceRoleKey ? "Til stede" : "Mangler"}
                </span>
              </div>
              <div className="status-item">
                <span>C1ST_API_TOKEN</span>
                <span className={`pill ${env.c1stApiToken ? "pill--ok" : "pill--missing"}`}>
                  {env.c1stApiToken ? "Til stede" : "Mangler"}
                </span>
              </div>
              <div className="status-item">
                <span>CRON_SECRET</span>
                <span className={`pill ${env.cronSecret ? "pill--ok" : "pill--missing"}`}>
                  {env.cronSecret ? "Til stede" : "Mangler"}
                </span>
              </div>
            </div>
            <p className="muted" style={{ marginTop: 16 }}>
              Automatisk sync kører via Supabase Cron hvert 10. minut.
            </p>
          </section>

          <section className="panel panel--link">
            <div className="panel__header">
              <div>
                <p className="eyebrow">TV-visning</p>
                <h2>Fullscreen bar chart</h2>
              </div>
            </div>
            <p className="muted">Store søjler pr. mekaniker, 8 timers mållinje og sidst opdateret.</p>
            <p className="inline-links">
              <Link href="/dashboard" rel="noreferrer" target="_blank">
                Åbn TV-visning
              </Link>
            </p>
          </section>

          <section className="panel panel--link">
            <div className="panel__header">
              <div>
                <p className="eyebrow">Rapporter</p>
                <h2>Tabel og CSV</h2>
              </div>
            </div>
            <p className="muted">Dagligt, ugentligt snit, månedligt snit, summeret eller detaljeret.</p>
            <p className="inline-links">
              <Link href="/reports">Åbn rapporter</Link>
            </p>
          </section>

          <section className="panel panel--link">
            <div className="panel__header">
              <div>
                <p className="eyebrow">Indstillinger</p>
                <h2>Mekanikere og mål</h2>
              </div>
            </div>
            <p className="muted">Tilføj mekanikere, varenummer og dagligt mål direkte i appen.</p>
            <p className="inline-links">
              <Link href="/settings">Åbn indstillinger</Link>
            </p>
          </section>
        </section>

        <InternalActions />
      </main>
    </>
  );
}

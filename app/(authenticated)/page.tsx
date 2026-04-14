import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { InternalActions } from "@/components/internal-actions";
import { getDashboardData } from "@/lib/data/dashboard";
import { getActiveMechanics } from "@/lib/data/reports";
import { getDashboardReadinessMessage, getEnvPresence, getSyncReadinessMessage, toOperatorErrorMessage } from "@/lib/env";
import { formatCopenhagenTime, formatHours } from "@/lib/time";

export const dynamic = "force-dynamic";

type StatusRow = {
  label: string;
  present: boolean;
};

type StatusGroup = {
  title: string;
  summary: string;
  ready: boolean;
  rows: StatusRow[];
};

function getStatusGroups() {
  const env = getEnvPresence();

  const groups: StatusGroup[] = [
    {
      title: "Browser og login",
      summary: "Bruges til login og den offentlige Supabase-klient i browseren.",
      ready: env.browserAuthReady,
      rows: [
        { label: "NEXT_PUBLIC_SUPABASE_URL", present: env.publicSupabaseUrl },
        { label: "NEXT_PUBLIC_SUPABASE_ANON_KEY", present: env.supabaseAnonKey },
      ],
    },
    {
      title: "Server og datasync",
      summary: "Bruges til dashboarddata, rapporter og manuel sync mod Customers 1st.",
      ready: env.syncReady,
      rows: [
        { label: "Supabase URL (SUPABASE_URL eller NEXT_PUBLIC_SUPABASE_URL)", present: env.resolvedSupabaseUrl },
        { label: "SUPABASE_SERVICE_ROLE_KEY", present: env.supabaseServiceRoleKey },
        { label: "C1ST_API_TOKEN", present: env.c1stApiToken },
      ],
    },
    {
      title: "Scheduler",
      summary: "Bruges af Supabase Cron til automatisk sync hvert 15. minut.",
      ready: env.schedulerReady,
      rows: [{ label: "CRON_SECRET", present: env.cronSecret }],
    },
  ];

  return { env, groups };
}

export default async function HomePage() {
  const { env, groups } = getStatusGroups();
  const dashboardReadinessMessage = getDashboardReadinessMessage(env);
  const syncReadinessMessage = getSyncReadinessMessage(env);

  let loadError: string | null = null;
  let mechanics: Awaited<ReturnType<typeof getActiveMechanics>> = [];
  let dashboard: Awaited<ReturnType<typeof getDashboardData>> = {
    statDate: "ikke tilgængelig",
    statDateLabel: "ikke tilgængelig",
    rows: [],
    latestSync: null,
  };

  if (env.dashboardReady) {
    try {
      [dashboard, mechanics] = await Promise.all([getDashboardData(), getActiveMechanics()]);
    } catch (error) {
      loadError = toOperatorErrorMessage(error, "Kunne ikke hente data fra Supabase.");
    }
  } else {
    loadError = dashboardReadinessMessage;
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

        <section className="panel-grid panel-grid--metrics">
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
          <section className="panel panel--warning" style={{ marginBottom: 24 }}>
            <p className="eyebrow">Opsætning</p>
            <h2>Data er ikke klar endnu</h2>
            <p className="muted">{loadError}</p>
          </section>
        ) : null}

        <section className="panel-grid panel-grid--features">
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

        <InternalActions disabledReason={syncReadinessMessage} syncReady={env.syncReady} />

        <section className="panel panel--status admin-grid">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Miljø</p>
              <h2>Driftsklar status</h2>
            </div>
          </div>
          <div className="status-groups">
            {groups.map((group) => (
              <section className="status-group" key={group.title}>
                <div className="status-group__header">
                  <div>
                    <h3 className="status-group__title">{group.title}</h3>
                    <p className="muted status-note">{group.summary}</p>
                  </div>
                  <span className={`pill ${group.ready ? "pill--ok" : "pill--missing"}`}>
                    {group.ready ? "Klar" : "Mangler"}
                  </span>
                </div>
                <div className="status-list">
                  {group.rows.map((row) => (
                    <div className="status-item" key={row.label}>
                      <span className="status-item__label">{row.label}</span>
                      <span className={`pill ${row.present ? "pill--ok" : "pill--missing"}`}>
                        {row.present ? "Til stede" : "Mangler"}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}

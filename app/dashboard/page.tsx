import { DashboardRefresh } from "@/components/dashboard-refresh";
import { getDashboardData } from "@/lib/data/dashboard";
import { getDashboardReadinessMessage, getEnvPresence, toOperatorErrorMessage } from "@/lib/env";
import { formatCopenhagenDate, formatCopenhagenTime, formatHours, getCopenhagenDateString } from "@/lib/time";

export const dynamic = "force-dynamic";

const CHART_MAX_HOURS = 10;

function clampRatio(hours: number) {
  return Math.min(Math.max((hours / CHART_MAX_HOURS) * 100, 0), 100);
}

type Rgb = [number, number, number];

function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function rgb(c: Rgb) {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// Pastel/matte stops — bottom of bar (darker), top (lighter)
const RED_BOT: Rgb   = [196, 100, 100]; // #c46464
const RED_TOP: Rgb   = [220, 148, 148]; // #dc9494
const YLW_BOT: Rgb   = [195, 162,  52]; // #c3a234
const YLW_TOP: Rgb   = [220, 196, 110]; // #dcc46e
const GRN_BOT: Rgb   = [ 88, 168,  96]; // #58a860
const GRN_TOP: Rgb   = [128, 200, 138]; // #80c88a

// Text colours that keep contrast on each tint
const RED_TEXT   = "#3d1010";
const YLW_TEXT   = "#2a1e00";
const GRN_TEXT   = "#0c2e12";

function barStyle(pct: number): React.CSSProperties {
  const p = Math.max(0, pct);

  let bot: Rgb, top: Rgb, textColor: string;

  if (p <= 0.7) {
    const t = p / 0.7;
    bot = lerpRgb(RED_BOT, YLW_BOT, t);
    top = lerpRgb(RED_TOP, YLW_TOP, t);
    textColor = t < 0.5 ? RED_TEXT : YLW_TEXT;
  } else {
    const t = Math.min((p - 0.7) / 0.3, 1);
    bot = lerpRgb(YLW_BOT, GRN_BOT, t);
    top = lerpRgb(YLW_TOP, GRN_TOP, t);
    textColor = t < 0.5 ? YLW_TEXT : GRN_TEXT;
  }

  return {
    background: `linear-gradient(180deg, ${rgb(top)} 0%, ${rgb(bot)} 100%)`,
    color: textColor,
  };
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

  return (
    <main className="dashboard-shell">
      <DashboardRefresh initialRefreshToken={dashboard.latestSync?.refreshToken ?? null} />
      <section className="dashboard-card">
        <header className="dashboard-header">
          <div>
            <p className="eyebrow">TV-visning</p>
            <h1>Registreret arbejdstid</h1>
          </div>
          <div className="dashboard-meta">
            <p>{todayLabel}</p>
            <p className="muted">Opdaterer automatisk efter ny sync · Sidst opdateret {lastUpdatedLabel}</p>
          </div>
        </header>

        <section className="chart-shell">
          <div className="bars">
            {dashboard.rows.length > 0 ? (
              dashboard.rows.map((row) => {
                const targetHours = Math.max(0, row.targetHours);
                const hours = Math.max(0, row.hours);
                const fillRatio = hours <= 0 ? 0 : Math.max(clampRatio(hours), 4);
                const targetRatio = clampRatio(targetHours);
                const pct = targetHours > 0 ? hours / targetHours : 0;

                return (
                  <article className="bar-card" key={row.id}>
                    <div className="bar-track">
                      <div className="bar-target-line" style={{ bottom: `${targetRatio}%` }} />
                      <div
                        className="bar-fill"
                        style={{ height: `${fillRatio}%`, ...barStyle(pct) }}
                      >
                        {row.quarters > 0 ? `${row.quarters.toFixed(0)} kv` : ""}
                      </div>
                      <div
                        className="bar-value-overlay"
                        style={{ bottom: `calc(${fillRatio}% + 10px)` }}
                      >
                        {formatHours(row.hours)}
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

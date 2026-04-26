"use client";

import { useState } from "react";
import Link from "next/link";

export const dynamic = "force-dynamic";

type SyncResponse = {
  ok?: boolean;
  error?: string;
  syncDate?: string;
  ticketsFetched?: number;
  materialsProcessed?: number;
  mechanicTotals?: Record<string, number>;
  durationMs?: number;
};

export default function ControlPanelPage() {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<SyncResponse | null>(null);

  async function handleSync() {
    setSyncing(true);
    setResult(null);
    try {
      const res = await fetch("/api/sync/manual", { method: "POST" });
      const json = (await res.json()) as SyncResponse;
      setResult(json);
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : "Ukendt fejl" });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <main className="page-shell">
      <div className="hero">
        <div className="hero__top">
          <div>
            <p className="eyebrow">B-Bikes</p>
            <h1>Kontrolpanel</h1>
          </div>
        </div>
        <p className="muted">
          Administrer synkronisering og se systemstatus. TV-dashboardet opdateres automatisk kl. 16:00 hver dag.
        </p>
      </div>

      {/* Navigation */}
      <nav className="nav">
        <span className="nav__link nav__link--active">Kontrolpanel</span>
        <Link href="/reports" className="nav__link">Rapporter</Link>
        <Link href="/settings" className="nav__link">Indstillinger</Link>
        <Link href="/dashboard" className="nav__link" target="_blank">TV-dashboard ↗</Link>
      </nav>

      <div className="panel-grid">
        {/* Sync panel */}
        <div className="panel">
          <p className="eyebrow">Synkronisering</p>
          <h2>Kør sync nu</h2>
          <p className="muted">
            Henter alle BikeDesk-opgaver opdateret i dag og beregner mekanikernes kvarterer for i dag.
            Kør dette hvis du vil se opdaterede tal med det samme — ellers kører det automatisk kl. 16:00.
          </p>
          <div className="action-row" style={{ marginBottom: 0 }}>
            <button
              className="button button--accent"
              onClick={() => void handleSync()}
              disabled={syncing}
            >
              {syncing ? "Synkroniserer…" : "Sync"}
            </button>
          </div>

          {result && (
            <div className={`response-box${result.error ? " response-box--error" : ""}`}>
              <p className="response-box__label">{result.error ? "Fejl" : "Resultat"}</p>
              <pre>
                {result.error
                  ? result.error
                  : JSON.stringify(
                      {
                        dato: result.syncDate,
                        opgaver_hentet: result.ticketsFetched,
                        materialer_behandlet: result.materialsProcessed,
                        tid: `${((result.durationMs ?? 0) / 1000).toFixed(1)}s`,
                        kvarterer_pr_mekaniker: result.mechanicTotals,
                      },
                      null,
                      2,
                    )}
              </pre>
            </div>
          )}
        </div>

        {/* Quick links */}
        <div className="panel">
          <p className="eyebrow">Genveje</p>
          <h2>Sider</h2>
          <div className="status-list">
            <div className="status-item">
              <div className="status-item__label">
                <strong>TV-dashboard</strong>
                <p className="muted" style={{ fontSize: "0.85rem" }}>Roterer: i går → aktuel uge → aktuel måned</p>
              </div>
              <Link href="/dashboard" target="_blank" className="button button--ghost" style={{ fontSize: "0.85rem", padding: "8px 14px" }}>
                Åbn ↗
              </Link>
            </div>
            <div className="status-item">
              <div className="status-item__label">
                <strong>Rapporter</strong>
                <p className="muted" style={{ fontSize: "0.85rem" }}>Kvarterer pr. mekaniker for alle 3 perioder</p>
              </div>
              <Link href="/reports" className="button button--ghost" style={{ fontSize: "0.85rem", padding: "8px 14px" }}>
                Åbn
              </Link>
            </div>
            <div className="status-item">
              <div className="status-item__label">
                <strong>Indstillinger</strong>
                <p className="muted" style={{ fontSize: "0.85rem" }}>Mekanikere, varenumre og dagligt mål</p>
              </div>
              <Link href="/settings" className="button button--ghost" style={{ fontSize: "0.85rem", padding: "8px 14px" }}>
                Åbn
              </Link>
            </div>
          </div>
        </div>

        {/* Scheduler info */}
        <div className="panel">
          <p className="eyebrow">Automatisk sync</p>
          <h2>Scheduler</h2>
          <p className="muted">
            Supabase pg_cron kører automatisk en sync kl. <strong>16:00</strong> (dansk sommertid) hver dag.
            Se <code>supabase/admin/setup_supabase_cron.sql.example</code> for opsætning.
          </p>
          <div className="status-list">
            <div className="status-item">
              <span>Kørselstidspunkt</span>
              <span className="pill pill--ok">16:00 dagligt</span>
            </div>
            <div className="status-item">
              <span>Endpoint</span>
              <code style={{ fontSize: "0.8rem", color: "var(--muted)" }}>/api/cron/sync</code>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

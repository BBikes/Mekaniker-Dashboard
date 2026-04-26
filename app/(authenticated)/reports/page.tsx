"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

export const dynamic = "force-dynamic";

type PeriodTotals = {
  mechanic_id: string;
  quarters: number;
};

type Mechanic = {
  id: string;
  name: string;
  sku: string;
  display_order: number;
  active: boolean;
  daily_target_quarters: number;
};

type ReportsData = {
  yesterday: PeriodTotals[];
  current_week: PeriodTotals[];
  current_month: PeriodTotals[];
  lastSyncAt: string | null;
  mechanics: Mechanic[];
  periods: {
    yesterday: string;
    weekStart: string;
    monthStart: string;
  };
};

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${parseInt(d)}/${parseInt(m)}/${y}`;
}

function formatTime(iso: string | null): string {
  if (!iso) return "–";
  const d = new Date(iso);
  return d.toLocaleString("da-DK", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function countWorkDays(from: string, to: string): number {
  let days = 0;
  const cur = new Date(from);
  const end = new Date(to);
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) days++;
    cur.setDate(cur.getDate() + 1);
  }
  return Math.max(days, 1);
}

function PeriodTable({
  title,
  subtitle,
  mechanics,
  totals,
  targetDays,
}: {
  title: string;
  subtitle: string;
  mechanics: Mechanic[];
  totals: PeriodTotals[];
  targetDays: number;
}) {
  const totalsMap = new Map(totals.map((t) => [t.mechanic_id, t.quarters]));
  const grandTotal = mechanics.reduce((s, m) => s + (totalsMap.get(m.id) ?? 0), 0);
  const grandTarget = mechanics.reduce((s, m) => s + m.daily_target_quarters * targetDays, 0);

  return (
    <div className="panel" style={{ marginBottom: "24px" }}>
      <div>
        <p className="eyebrow">{title}</p>
        <p className="muted" style={{ fontSize: "0.9rem", margin: "4px 0 0" }}>{subtitle}</p>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Mekaniker</th>
              <th className="num">Kvarterer</th>
              <th className="num">Timer</th>
              <th className="num">Mål</th>
              <th className="num">Opfyldelse</th>
              <th style={{ width: "120px" }}>Fremgang</th>
            </tr>
          </thead>
          <tbody>
            {mechanics.map((m) => {
              const quarters = totalsMap.get(m.id) ?? 0;
              const hours = (quarters * 15) / 60;
              const target = m.daily_target_quarters * targetDays;
              const pct = target > 0 ? quarters / target : 0;
              const pctLabel = target > 0 ? `${Math.round(pct * 100)}%` : "–";
              const pctCapped = Math.min(pct, 1);

              return (
                <tr key={m.id}>
                  <td><strong>{m.name}</strong></td>
                  <td className="num">{quarters}</td>
                  <td className="num">{hours.toFixed(1)}</td>
                  <td className="num">{target > 0 ? target : "–"}</td>
                  <td className="num"
                    style={{ color: pct >= 1 ? "#059669" : pct >= 0.7 ? "#d97706" : "#dc2626", fontWeight: 700 }}>
                    {pctLabel}
                  </td>
                  <td>
                    <div className="progress-bar">
                      <div
                        className="progress-bar__fill"
                        style={{
                          width: `${pctCapped * 100}%`,
                          background: pct >= 1 ? "#10b981" : pct >= 0.7 ? "#f59e0b" : "#ef4444",
                        }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "2px solid var(--line)" }}>
              <td><strong>Total</strong></td>
              <td className="num"><strong>{grandTotal}</strong></td>
              <td className="num"><strong>{((grandTotal * 15) / 60).toFixed(1)}</strong></td>
              <td className="num"><strong>{grandTarget || "–"}</strong></td>
              <td className="num">
                <strong style={{ color: grandTarget > 0 && grandTotal >= grandTarget ? "#059669" : undefined }}>
                  {grandTarget > 0 ? `${Math.round((grandTotal / grandTarget) * 100)}%` : "–"}
                </strong>
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const [data, setData] = useState<ReportsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/data", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ReportsData;
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fejl");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const activeMechanics = (data?.mechanics ?? [])
    .filter((m) => m.active)
    .sort((a, b) => a.display_order - b.display_order);

  const weekDays = data ? countWorkDays(data.periods.weekStart, data.periods.yesterday) : 5;
  const monthDays = data ? countWorkDays(data.periods.monthStart, data.periods.yesterday) : 22;

  return (
    <main className="page-shell">
      <div className="hero">
        <div className="hero__top">
          <div>
            <p className="eyebrow">B-Bikes</p>
            <h1>Rapporter</h1>
          </div>
          {data?.lastSyncAt && (
            <p className="muted" style={{ fontSize: "0.85rem", alignSelf: "flex-end" }}>
              Sidst synkroniseret {formatTime(data.lastSyncAt)}
            </p>
          )}
        </div>
      </div>

      <nav className="nav">
        <Link href="/" className="nav__link">Kontrolpanel</Link>
        <span className="nav__link nav__link--active">Rapporter</span>
        <Link href="/settings" className="nav__link">Indstillinger</Link>
        <Link href="/dashboard" className="nav__link" target="_blank">TV-dashboard ↗</Link>
      </nav>

      {loading && <p className="muted">Indlæser…</p>}

      {error && (
        <div className="response-box response-box--error" style={{ marginBottom: "24px" }}>
          <p className="response-box__label">Fejl</p>
          <pre>{error}</pre>
        </div>
      )}

      {data && (
        <>
          <PeriodTable
            title="I går"
            subtitle={formatDate(data.periods.yesterday)}
            mechanics={activeMechanics}
            totals={data.yesterday}
            targetDays={1}
          />
          <PeriodTable
            title="Aktuel uge"
            subtitle={`${formatDate(data.periods.weekStart)} – ${formatDate(data.periods.yesterday)} · ${weekDays} arbejdsdage`}
            mechanics={activeMechanics}
            totals={data.current_week}
            targetDays={weekDays}
          />
          <PeriodTable
            title="Aktuel måned"
            subtitle={`${formatDate(data.periods.monthStart)} – ${formatDate(data.periods.yesterday)} · ${monthDays} arbejdsdage`}
            mechanics={activeMechanics}
            totals={data.current_month}
            targetDays={monthDays}
          />
        </>
      )}
    </main>
  );
}

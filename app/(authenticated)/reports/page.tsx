"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

export const dynamic = "force-dynamic";

// ─── Types ────────────────────────────────────────────────────────────────────

type BoardType = "today" | "yesterday" | "current_week" | "current_month";

type BoardSetting = {
  board_type: BoardType;
  active: boolean;
  label: string;
  sort_order: number;
};

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
  today: PeriodTotals[];
  yesterday: PeriodTotals[];
  current_week: PeriodTotals[];
  current_month: PeriodTotals[];
  lastSyncAt: string | null;
  mechanics: Mechanic[];
  periods: {
    today: string;
    yesterday: string;
    weekStart: string;
    monthStart: string;
  };
  boardSettings: BoardSetting[];
};

type TicketDetailResponse = {
  mechanic_id: string;
  from: string;
  to: string;
  ticket_ids: number[];
  by_date: Record<string, number[]>;
  total: number;
};

type TicketDrawerState = {
  mechanicName: string;
  periodLabel: string;
  from: string;
  to: string;
  mechanicId: string;
} | null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${parseInt(d)}/${parseInt(m)}/${y}`;
}

function formatDateShort(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${parseInt(d)}/${parseInt(m)}`;
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

// ─── Ticket Drawer ────────────────────────────────────────────────────────────

function TicketDrawer({
  state,
  onClose,
}: {
  state: TicketDrawerState;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<TicketDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!state) {
      setData(null);
      setError(null);
      return;
    }

    setLoading(true);
    setData(null);
    setError(null);

    const url = `/api/reports/tickets?mechanic_id=${encodeURIComponent(state.mechanicId)}&from=${state.from}&to=${state.to}`;

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<TicketDetailResponse>;
      })
      .then((json) => {
        setData(json);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Fejl");
      })
      .finally(() => setLoading(false));
  }, [state]);

  if (!state) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.35)",
          zIndex: 100,
        }}
      />

      {/* Drawer */}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(420px, 100vw)",
          background: "var(--bg)",
          borderLeft: "1px solid var(--line)",
          zIndex: 101,
          display: "flex",
          flexDirection: "column",
          boxShadow: "-4px 0 24px rgba(0,0,0,0.12)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "24px 24px 16px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "16px",
          }}
        >
          <div>
            <p className="eyebrow" style={{ marginBottom: "4px" }}>{state.periodLabel}</p>
            <h2 style={{ margin: 0, fontSize: "1.3rem" }}>{state.mechanicName}</h2>
            <p className="muted" style={{ fontSize: "0.85rem", marginTop: "4px" }}>
              {formatDate(state.from)}{state.from !== state.to ? ` – ${formatDate(state.to)}` : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: "1.4rem",
              cursor: "pointer",
              color: "var(--muted)",
              padding: "4px",
              lineHeight: 1,
              flexShrink: 0,
            }}
            aria-label="Luk"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {loading && (
            <p className="muted" style={{ textAlign: "center", paddingTop: "32px" }}>Henter arbejdskort…</p>
          )}

          {error && (
            <div className="response-box response-box--error">
              <p className="response-box__label">Fejl</p>
              <pre>{error}</pre>
            </div>
          )}

          {data && !loading && (
            <>
              <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "16px" }}>
                {data.total === 0
                  ? "Ingen arbejdskort fundet for denne periode."
                  : `${data.total} arbejdskort med registreret tid.`}
              </p>

              {data.total > 0 && (
                <>
                  {/* Flat list of ticket IDs */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "24px" }}>
                    {data.ticket_ids.map((id) => (
                      <span
                        key={id}
                        style={{
                          display: "inline-block",
                          padding: "5px 12px",
                          borderRadius: "6px",
                          background: "var(--surface)",
                          border: "1px solid var(--line)",
                          fontFamily: "monospace",
                          fontSize: "0.9rem",
                          fontWeight: 600,
                          letterSpacing: "0.03em",
                        }}
                      >
                        #{id}
                      </span>
                    ))}
                  </div>

                  {/* By date breakdown (only if period spans multiple days) */}
                  {state.from !== state.to && Object.keys(data.by_date).length > 1 && (
                    <>
                      <p className="eyebrow" style={{ marginBottom: "12px" }}>Fordeling pr. dag</p>
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {Object.entries(data.by_date)
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([date, ids]) => (
                            <div
                              key={date}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "flex-start",
                                gap: "12px",
                                padding: "10px 12px",
                                borderRadius: "6px",
                                background: "var(--surface)",
                                border: "1px solid var(--line)",
                              }}
                            >
                              <span style={{ fontWeight: 600, flexShrink: 0 }}>
                                {formatDateShort(date)}
                              </span>
                              <span style={{ fontFamily: "monospace", fontSize: "0.85rem", color: "var(--muted)", textAlign: "right" }}>
                                {ids.map((id) => `#${id}`).join(", ")}
                              </span>
                            </div>
                          ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Period Table ─────────────────────────────────────────────────────────────

function PeriodTable({
  title,
  subtitle,
  mechanics,
  totals,
  targetDays,
  from,
  to,
  onMechanicClick,
}: {
  title: string;
  subtitle: string;
  mechanics: Mechanic[];
  totals: PeriodTotals[];
  targetDays: number;
  from: string;
  to: string;
  onMechanicClick: (mechanic: Mechanic, from: string, to: string, periodLabel: string) => void;
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
                  <td>
                    <button
                      onClick={() => onMechanicClick(m, from, to, title)}
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                        fontWeight: 700,
                        fontSize: "inherit",
                        color: "var(--accent)",
                        textDecoration: "underline",
                        textDecorationStyle: "dotted",
                        textUnderlineOffset: "3px",
                        fontFamily: "inherit",
                      }}
                      title={`Se arbejdskort for ${m.name}`}
                    >
                      {m.name}
                    </button>
                  </td>
                  <td className="num">{quarters}</td>
                  <td className="num">{hours.toFixed(1)}</td>
                  <td className="num">{target > 0 ? target : "–"}</td>
                  <td
                    className="num"
                    style={{
                      color: pct >= 1 ? "#059669" : pct >= 0.7 ? "#d97706" : "#dc2626",
                      fontWeight: 700,
                    }}
                  >
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

// ─── Reports Page ─────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const [data, setData] = useState<ReportsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawerState, setDrawerState] = useState<TicketDrawerState>(null);

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

  function handleMechanicClick(
    mechanic: Mechanic,
    from: string,
    to: string,
    periodLabel: string,
  ) {
    setDrawerState({
      mechanicId: mechanic.id,
      mechanicName: mechanic.name,
      periodLabel,
      from,
      to,
    });
  }

  const activeMechanics = (data?.mechanics ?? [])
    .filter((m) => m.active)
    .sort((a, b) => a.display_order - b.display_order);

  const activeBoards = (data?.boardSettings ?? [])
    .filter((b) => b.active)
    .sort((a, b) => a.sort_order - b.sort_order);

  const weekDays = data ? countWorkDays(data.periods.weekStart, data.periods.yesterday) : 5;
  const monthDays = data ? countWorkDays(data.periods.monthStart, data.periods.yesterday) : 22;

  function renderBoard(board: BoardSetting) {
    if (!data) return null;
    switch (board.board_type) {
      case "today":
        return (
          <PeriodTable
            key="today"
            title={board.label}
            subtitle={formatDate(data.periods.today)}
            mechanics={activeMechanics}
            totals={data.today}
            targetDays={1}
            from={data.periods.today}
            to={data.periods.today}
            onMechanicClick={handleMechanicClick}
          />
        );
      case "yesterday":
        return (
          <PeriodTable
            key="yesterday"
            title={board.label}
            subtitle={formatDate(data.periods.yesterday)}
            mechanics={activeMechanics}
            totals={data.yesterday}
            targetDays={1}
            from={data.periods.yesterday}
            to={data.periods.yesterday}
            onMechanicClick={handleMechanicClick}
          />
        );
      case "current_week":
        return (
          <PeriodTable
            key="current_week"
            title={board.label}
            subtitle={`${formatDate(data.periods.weekStart)} – ${formatDate(data.periods.yesterday)} · ${weekDays} arbejdsdage`}
            mechanics={activeMechanics}
            totals={data.current_week}
            targetDays={weekDays}
            from={data.periods.weekStart}
            to={data.periods.yesterday}
            onMechanicClick={handleMechanicClick}
          />
        );
      case "current_month":
        return (
          <PeriodTable
            key="current_month"
            title={board.label}
            subtitle={`${formatDate(data.periods.monthStart)} – ${formatDate(data.periods.yesterday)} · ${monthDays} arbejdsdage`}
            mechanics={activeMechanics}
            totals={data.current_month}
            targetDays={monthDays}
            from={data.periods.monthStart}
            to={data.periods.yesterday}
            onMechanicClick={handleMechanicClick}
          />
        );
    }
  }

  return (
    <>
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

        {data && activeBoards.length === 0 && (
          <div className="panel">
            <p className="muted" style={{ textAlign: "center", padding: "24px 0" }}>
              Ingen aktive boards. Aktivér mindst ét board i{" "}
              <Link href="/settings" className="link">Indstillinger</Link>.
            </p>
          </div>
        )}

        {data && activeBoards.map((board) => renderBoard(board))}
      </main>

      <TicketDrawer state={drawerState} onClose={() => setDrawerState(null)} />
    </>
  );
}

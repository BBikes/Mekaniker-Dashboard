"use client";

import { useEffect, useState, useCallback } from "react";

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

type DashboardApiData = {
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

type BoardType = "yesterday" | "current_week" | "current_month";

const BOARDS: BoardType[] = ["yesterday", "current_week", "current_month"];
const ROTATION_MS = 15000;

function formatDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${parseInt(d)}/${parseInt(m)}`;
}

function formatTime(iso: string | null): string {
  if (!iso) return "–";
  const d = new Date(iso);
  return d.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" });
}

function boardLabel(board: BoardType, periods: DashboardApiData["periods"]): string {
  switch (board) {
    case "yesterday":
      return `I går — ${formatDate(periods.yesterday)}`;
    case "current_week":
      return `Aktuel uge — ${formatDate(periods.weekStart)}–${formatDate(periods.yesterday)}`;
    case "current_month":
      return `Aktuel måned — ${periods.monthStart.slice(5, 7)}/${periods.monthStart.slice(0, 4)}`;
  }
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

function getPeriodTargetMultiplier(board: BoardType, periods: DashboardApiData["periods"]): number {
  switch (board) {
    case "yesterday":
      return 1;
    case "current_week":
      return countWorkDays(periods.weekStart, periods.yesterday);
    case "current_month":
      return countWorkDays(periods.monthStart, periods.yesterday);
  }
}

function getBarColor(pct: number): string {
  if (pct >= 1.0) return "linear-gradient(180deg, #10b981, #059669)";
  if (pct >= 0.7) return "linear-gradient(180deg, #f59e0b, #d97706)";
  return "linear-gradient(180deg, #ef4444, #dc2626)";
}

function BarChart({
  mechanics,
  totals,
  targetMultiplier,
}: {
  mechanics: Mechanic[];
  totals: PeriodTotals[];
  targetMultiplier: number;
}) {
  const totalsMap = new Map(totals.map((t) => [t.mechanic_id, t.quarters]));
  const values = mechanics.map((m) => totalsMap.get(m.id) ?? 0);
  const targets = mechanics.map((m) => m.daily_target_quarters * targetMultiplier);
  const maxVal = Math.max(...values, ...targets, 1);

  return (
    <div className="chart-shell">
      <div className="bars">
        {mechanics.map((m, i) => {
          const quarters = values[i];
          const target = targets[i];
          const pct = target > 0 ? quarters / target : 0;
          const heightPct = Math.min((quarters / maxVal) * 100, 100);
          const targetPct = Math.min((target / maxVal) * 100, 100);

          return (
            <div key={m.id} className="bar-card">
              <div className="bar-track">
                {target > 0 && (
                  <div
                    className="bar-target-line"
                    style={{ bottom: `${targetPct}%` }}
                    title={`Mål: ${target} kvt.`}
                  />
                )}
                <div
                  className="bar-fill"
                  style={{
                    height: `${Math.max(heightPct, 1.5)}%`,
                    background: getBarColor(pct),
                    color: "white",
                  }}
                >
                  {quarters > 0 && (
                    <span style={{ fontSize: "1.1rem", fontWeight: 800 }}>{quarters}</span>
                  )}
                </div>
                {quarters === 0 && (
                  <div
                    style={{
                      position: "absolute",
                      bottom: "8px",
                      left: 0,
                      right: 0,
                      textAlign: "center",
                      color: "#bbb",
                      fontWeight: 700,
                    }}
                  >
                    0
                  </div>
                )}
              </div>
              <div className="bar-name">{m.name}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardApiData | null>(null);
  const [boardIndex, setBoardIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/data", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as DashboardApiData;
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fejl");
    }
  }, []);

  useEffect(() => {
    void fetchData();
    const interval = setInterval(() => void fetchData(), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  useEffect(() => {
    const interval = setInterval(() => {
      setBoardIndex((i) => (i + 1) % BOARDS.length);
    }, ROTATION_MS);
    return () => clearInterval(interval);
  }, []);

  if (error) {
    return (
      <div className="dashboard-shell" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: "1.5rem", fontWeight: 700, color: "#ef4444" }}>Fejl ved hentning af data</p>
          <p style={{ color: "#999" }}>{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="dashboard-shell" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "#999", fontSize: "1.2rem" }}>Indlæser…</p>
      </div>
    );
  }

  const activeMechanics = data.mechanics
    .filter((m) => m.active)
    .sort((a, b) => a.display_order - b.display_order);

  const currentBoard = BOARDS[boardIndex];
  const totals = data[currentBoard];
  const targetMultiplier = getPeriodTargetMultiplier(currentBoard, data.periods);

  return (
    <div className="dashboard-shell">
      <div className="dashboard-card">
        <div className="dashboard-header">
          <div>
            <p className="eyebrow">B-Bikes Værksted</p>
            <h1>{boardLabel(currentBoard, data.periods)}</h1>
          </div>
          <div className="dashboard-meta">
            <p className="muted" style={{ fontSize: "0.85rem" }}>
              Sidst synkroniseret {formatTime(data.lastSyncAt)}
            </p>
            <p className="muted" style={{ fontSize: "0.85rem", marginTop: "4px" }}>
              {boardIndex + 1} / {BOARDS.length}
            </p>
          </div>
        </div>

        <BarChart
          mechanics={activeMechanics}
          totals={totals}
          targetMultiplier={targetMultiplier}
        />

        <div style={{ display: "flex", justifyContent: "center", gap: "8px" }}>
          {BOARDS.map((_, i) => (
            <div
              key={i}
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: i === boardIndex ? "var(--accent)" : "var(--line)",
                transition: "background 0.3s",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

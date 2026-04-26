"use client";

import { useEffect, useState, useCallback } from "react";

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

type DashboardApiData = {
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

function boardLabel(board: BoardType, label: string, periods: DashboardApiData["periods"]): string {
  switch (board) {
    case "today":
      return `${label} — ${formatDate(periods.today)}`;
    case "yesterday":
      return `${label} — ${formatDate(periods.yesterday)}`;
    case "current_week":
      return `${label} — ${formatDate(periods.weekStart)}–${formatDate(periods.yesterday)}`;
    case "current_month":
      return `${label} — ${periods.monthStart.slice(5, 7)}/${periods.monthStart.slice(0, 4)}`;
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

function getTargetMultiplier(board: BoardType, periods: DashboardApiData["periods"]): number {
  switch (board) {
    case "today":
      return 1;
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

  // Rotation: advance board index, skip inactive boards
  useEffect(() => {
    const interval = setInterval(() => {
      setBoardIndex((i) => {
        if (!data) return i;
        const activeBoards = data.boardSettings
          .filter((b) => b.active)
          .sort((a, b) => a.sort_order - b.sort_order);
        if (activeBoards.length === 0) return i;
        return (i + 1) % activeBoards.length;
      });
    }, ROTATION_MS);
    return () => clearInterval(interval);
  }, [data]);

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

  const activeBoards = data.boardSettings
    .filter((b) => b.active)
    .sort((a, b) => a.sort_order - b.sort_order);

  if (activeBoards.length === 0) {
    return (
      <div className="dashboard-shell" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: "1.5rem", fontWeight: 700, color: "#999" }}>Ingen aktive boards</p>
          <p style={{ color: "#bbb" }}>Aktivér mindst ét board i Indstillinger.</p>
        </div>
      </div>
    );
  }

  const safeIndex = boardIndex % activeBoards.length;
  const currentBoardSetting = activeBoards[safeIndex];
  const currentBoard = currentBoardSetting.board_type;
  const totals = data[currentBoard];
  const targetMultiplier = getTargetMultiplier(currentBoard, data.periods);

  return (
    <div className="dashboard-shell">
      <div className="dashboard-card">
        <div className="dashboard-header">
          <div>
            <p className="eyebrow">B-Bikes Værksted</p>
            <h1>{boardLabel(currentBoard, currentBoardSetting.label, data.periods)}</h1>
          </div>
          <div className="dashboard-meta">
            <p className="muted" style={{ fontSize: "0.85rem" }}>
              Sidst synkroniseret {formatTime(data.lastSyncAt)}
            </p>
            <p className="muted" style={{ fontSize: "0.85rem", marginTop: "4px" }}>
              {safeIndex + 1} / {activeBoards.length}
            </p>
          </div>
        </div>

        <BarChart
          mechanics={activeMechanics}
          totals={totals}
          targetMultiplier={targetMultiplier}
        />

        <div style={{ display: "flex", justifyContent: "center", gap: "8px" }}>
          {activeBoards.map((_, i) => (
            <div
              key={i}
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: i === safeIndex ? "var(--accent)" : "var(--line)",
                transition: "background 0.3s",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { DashboardBoard, DashboardBarRow, DashboardFocusMetric, DashboardRevenueBar } from "@/lib/data/dashboard";
import { formatHours } from "@/lib/time";

type DashboardRotatorProps = {
  boards: DashboardBoard[];
  initialRefreshToken: string;
  lastUpdatedLabel: string;
  pollMs?: number;
};

type DashboardStatusResponse = {
  refreshToken: string;
};

const MIN_BAR_RATIO = 4;
const TARGET_LINE_RATIO = 75;

type Rgb = [number, number, number];

const RED_BOT: Rgb = [196, 100, 100];
const RED_TOP: Rgb = [220, 148, 148];
const YLW_BOT: Rgb = [195, 162, 52];
const YLW_TOP: Rgb = [220, 196, 110];
const GRN_BOT: Rgb = [88, 168, 96];
const GRN_TOP: Rgb = [128, 200, 138];

const RED_TEXT = "#3d1010";
const YLW_TEXT = "#2a1e00";
const GRN_TEXT = "#0c2e12";

function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function rgb(value: Rgb) {
  return `rgb(${value[0]},${value[1]},${value[2]})`;
}

function barStyle(pct: number): React.CSSProperties {
  const normalized = Math.max(0, pct);

  let bottom: Rgb;
  let top: Rgb;
  let textColor: string;

  if (normalized <= 0.7) {
    const progress = normalized / 0.7;
    bottom = lerpRgb(RED_BOT, YLW_BOT, progress);
    top = lerpRgb(RED_TOP, YLW_TOP, progress);
    textColor = progress < 0.5 ? RED_TEXT : YLW_TEXT;
  } else {
    const progress = Math.min((normalized - 0.7) / 0.3, 1);
    bottom = lerpRgb(YLW_BOT, GRN_BOT, progress);
    top = lerpRgb(YLW_TOP, GRN_TOP, progress);
    textColor = progress < 0.5 ? YLW_TEXT : GRN_TEXT;
  }

  return {
    background: `linear-gradient(180deg, ${rgb(top)} 0%, ${rgb(bottom)} 100%)`,
    color: textColor,
  };
}

function clampBarHeight(hours: number, maxHours: number) {
  if (maxHours <= 0 || hours <= 0) {
    return 0;
  }

  return Math.min(Math.max((hours / maxHours) * 100, MIN_BAR_RATIO), 100);
}

function getTargetScaleMax(targetHours: number) {
  if (targetHours <= 0) {
    return 8;
  }

  return targetHours / (TARGET_LINE_RATIO / 100);
}

function PeriodBars({ rows }: { rows: DashboardBarRow[] }) {
  if (rows.length === 0) {
    return <p className="muted">Ingen registreringer i den valgte periode.</p>;
  }

  return (
    <div className="bars">
      {rows.map((row) => {
        const chartMax = getTargetScaleMax(row.targetHours);
        const fillRatio = clampBarHeight(row.hours, chartMax);
        const pct = row.targetHours > 0 ? row.hours / row.targetHours : 0;

        return (
          <article className="bar-card" key={row.id}>
            <div className="bar-track">
              <div className="bar-target-line" style={{ bottom: `${TARGET_LINE_RATIO}%` }} />
              <div className="bar-fill" style={{ height: `${fillRatio}%`, ...barStyle(pct) }}>
                {row.quarters > 0 ? `${row.quarters.toFixed(0)} kv` : ""}
              </div>
              <div className="bar-value-overlay" style={{ bottom: `calc(${TARGET_LINE_RATIO}% + 10px)` }}>
                {formatHours(row.hours)}
              </div>
            </div>
            <div className="bar-label">{row.mechanicName}</div>
          </article>
        );
      })}
    </div>
  );
}

function FocusMetricBars({ metrics }: { metrics: DashboardFocusMetric[] }) {
  return (
    <div className="focus-bars" style={{ gridTemplateColumns: `repeat(${metrics.length}, minmax(0, 1fr))` }}>
      {metrics.map((metric) => {
        const chartMax = getTargetScaleMax(metric.targetHours);
        const fillRatio = clampBarHeight(metric.hours, chartMax);
        const pct = metric.targetHours > 0 ? metric.hours / metric.targetHours : 0;

        return (
          <article className="focus-bar-card" key={metric.key}>
            <div className="focus-bar-track">
              <div className="bar-target-line" style={{ bottom: `${TARGET_LINE_RATIO}%` }} />
              <div className="bar-fill" style={{ height: `${fillRatio}%`, ...barStyle(pct) }}>
                {metric.quarters > 0 ? `${metric.quarters.toFixed(0)} kv` : ""}
              </div>
              <div className="focus-bar-value" style={{ bottom: `calc(${TARGET_LINE_RATIO}% + 10px)` }}>
                {formatHours(metric.hours)}
              </div>
            </div>
            <div className="focus-bar-label">{metric.label}</div>
          </article>
        );
      })}
    </div>
  );
}

function formatCurrency(value: number): string {
  return value.toLocaleString("da-DK", { maximumFractionDigits: 0 }) + " kr";
}

function RevenueBars({ bars }: { bars: DashboardRevenueBar[] }) {
  if (bars.length === 0) {
    return <p className="muted">Ingen data tilgængeligt.</p>;
  }

  return (
    <div className="bars">
      {bars.map((bar) => {
        const chartMax = getTargetScaleMax(bar.targetValue);
        const fillRatio = clampBarHeight(bar.value, chartMax);
        const pct = bar.targetValue > 0 ? bar.value / bar.targetValue : 0;

        return (
          <article className="bar-card" key={bar.key}>
            <div className="bar-track">
              {bar.targetValue > 0 && (
                <div className="bar-target-line" style={{ bottom: `${TARGET_LINE_RATIO}%` }} />
              )}
              <div className="bar-fill" style={{ height: `${Math.max(fillRatio, bar.value > 0 ? 4 : 0)}%`, ...barStyle(pct) }}>
                {bar.value > 0 && !bar.isCurrency ? bar.value.toFixed(0) : ""}
              </div>
              {bar.value > 0 && (
                <div className="bar-value-overlay" style={{ bottom: `calc(${TARGET_LINE_RATIO}% + 10px)` }}>
                  {bar.isCurrency ? formatCurrency(bar.value) : bar.value.toFixed(0)}
                </div>
              )}
            </div>
            <div className="bar-label">{bar.label}</div>
          </article>
        );
      })}
    </div>
  );
}

function DashboardBoardView({ board, lastUpdatedLabel }: { board: DashboardBoard | null; lastUpdatedLabel: string }) {
  if (!board) {
    return (
      <section className="dashboard-card">
        <header className="dashboard-header">
          <div>
            <p className="eyebrow">TV-visning</p>
            <h1>Ingen aktive dashboards</h1>
          </div>
        </header>
        <p className="muted">Aktivér mindst ét dashboard i indstillingerne for at vise TV-boardet.</p>
      </section>
    );
  }

  return (
    <section className="dashboard-card">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">TV-visning</p>
          <h1>{board.title}</h1>
        </div>
        <div className="dashboard-meta">
          <p>{board.rangeLabel}</p>
          <p className="muted">Sidst opdateret {lastUpdatedLabel}</p>
        </div>
      </header>

      <section className="chart-shell">
        {board.kind === "revenue" ? (
          <RevenueBars bars={board.bars} />
        ) : board.kind === "period" ? (
          <PeriodBars rows={board.rows} />
        ) : board.mechanics.length > 0 ? (
          <div className="focus-groups">
            {board.mechanics.map((mechanic) => (
              <section className="focus-group" key={mechanic.id} style={{ ["--focus-metric-count" as string]: mechanic.metrics.length }}>
                <FocusMetricBars metrics={mechanic.metrics} />
                <div className="focus-group-label">{mechanic.mechanicName}</div>
              </section>
            ))}
          </div>
        ) : (
          <p className="muted">Vælg mekanikere i indstillingerne for at bruge fokus-boardet.</p>
        )}
      </section>
    </section>
  );
}

export function DashboardRotator({ boards, initialRefreshToken, lastUpdatedLabel, pollMs = 30000 }: DashboardRotatorProps) {
  const router = useRouter();
  const latestTokenRef = useRef(initialRefreshToken);
  const [activeIndex, setActiveIndex] = useState(0);
  const boardSignature = useMemo(() => boards.map((board) => `${board.key}:${board.durationSeconds}`).join("|"), [boards]);
  const activeBoard = boards[activeIndex] ?? null;

  useEffect(() => {
    latestTokenRef.current = initialRefreshToken;
  }, [initialRefreshToken]);

  useEffect(() => {
    setActiveIndex(0);
  }, [boardSignature]);

  useEffect(() => {
    if (boards.length <= 1 || !activeBoard) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setActiveIndex((current) => (current + 1) % boards.length);
    }, activeBoard.durationSeconds * 1000);

    return () => window.clearTimeout(timeout);
  }, [activeBoard, boards.length]);

  useEffect(() => {
    let cancelled = false;

    async function checkForChanges() {
      try {
        const response = await fetch("/api/dashboard/status", {
          method: "GET",
          cache: "no-store",
          headers: {
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as DashboardStatusResponse;

        if (cancelled || !payload.refreshToken) {
          return;
        }

        if (latestTokenRef.current !== payload.refreshToken) {
          latestTokenRef.current = payload.refreshToken;
          router.refresh();
        }
      } catch {
        // Silent on polling failures; next poll can recover.
      }
    }

    const interval = window.setInterval(checkForChanges, pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [pollMs, router]);

  return <DashboardBoardView board={activeBoard} lastUpdatedLabel={lastUpdatedLabel} />;
}
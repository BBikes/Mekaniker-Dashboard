"use client";

import { useEffect, useRef, useState } from "react";

import { formatCopenhagenTime } from "@/lib/time";

type AffectedMechanic = {
  mechanicName: string;
  mechanicItemNo: string;
  missingRowCount: number;
};

type StatusAnomalies = {
  hasIssues: boolean;
  totalMissingRows: number;
  affectedMechanics: AffectedMechanic[];
  latestSyncFinishedAt: string | null;
};

type StatusResponse = {
  refreshToken?: string;
  anomalies?: StatusAnomalies;
};

type SyncAnomalyBannerProps = {
  /** How often to poll for new anomaly data (ms). Default: 60 seconds. */
  pollMs?: number;
  /** Initial anomaly data fetched server-side to avoid flicker on first load. */
  initialAnomalies?: StatusAnomalies | null;
};

/**
 * Admin-only banner that polls /api/dashboard/status and shows a dismissable
 * warning when today's sync has rows flagged as missing_in_latest_fetch.
 * Displays which mechanics are affected and how many lines are missing.
 */
export function SyncAnomalyBanner({ pollMs = 60_000, initialAnomalies = null }: SyncAnomalyBannerProps) {
  const [anomalies, setAnomalies] = useState<StatusAnomalies | null>(initialAnomalies);
  const [dismissed, setDismissed] = useState(false);
  const dismissedAtMissingCount = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/dashboard/status", {
          method: "GET",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });

        if (!res.ok || cancelled) return;

        const payload = (await res.json()) as StatusResponse;

        if (cancelled) return;

        const next = payload.anomalies ?? null;
        setAnomalies(next);

        // Re-show banner if the issue count changed since last dismissal
        if (next && next.totalMissingRows !== dismissedAtMissingCount.current) {
          setDismissed(false);
        }
      } catch {
        // Non-critical — silently skip failed polls
      }
    }

    const interval = window.setInterval(poll, pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [pollMs]);

  // Nothing to show
  if (!anomalies?.hasIssues || dismissed) return null;

  function handleDismiss() {
    dismissedAtMissingCount.current = anomalies?.totalMissingRows ?? null;
    setDismissed(true);
  }

  const timeLabel = anomalies.latestSyncFinishedAt
    ? `Seneste sync kl. ${formatCopenhagenTime(anomalies.latestSyncFinishedAt)}`
    : "Seneste sync-tidspunkt ukendt";

  return (
    <div className="sync-anomaly-banner" role="alert" aria-live="polite">
      <div className="sync-anomaly-banner__body">
        <span className="sync-anomaly-banner__icon" aria-hidden="true">
          ⚠️
        </span>
        <div className="sync-anomaly-banner__content">
          <strong className="sync-anomaly-banner__title">
            {anomalies.totalMissingRows} linje{anomalies.totalMissingRows !== 1 ? "r" : ""} manglede i seneste sync
          </strong>
          <span className="sync-anomaly-banner__sub">{timeLabel}</span>
          {anomalies.affectedMechanics.length > 0 && (
            <ul className="sync-anomaly-banner__mechanics">
              {anomalies.affectedMechanics.map((m) => (
                <li key={m.mechanicItemNo} className="sync-anomaly-banner__mechanic-item">
                  <span className="sync-anomaly-banner__mechanic-name">{m.mechanicName}</span>
                  <span className="sync-anomaly-banner__mechanic-count">
                    {m.missingRowCount} linje{m.missingRowCount !== 1 ? "r" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <button
        className="sync-anomaly-banner__dismiss"
        onClick={handleDismiss}
        aria-label="Luk sync-advarsel"
        type="button"
      >
        ✕
      </button>
    </div>
  );
}

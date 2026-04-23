"use client";

import { useState } from "react";

type ActionState = {
  label: string;
  output: string;
  error: boolean;
} | null;

const MANUAL_ACTION_TIMEOUT_MS = 240_000;

function toUiErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");

  if (message.includes("Missing required environment variable: SUPABASE_URL")) {
    return "Server-sync mangler Supabase URL.";
  }

  if (message.includes("Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY")) {
    return "Server-sync mangler Supabase service role key.";
  }

  if (message.includes("Missing required environment variable: C1ST_API_TOKEN")) {
    return "Customers 1st-token mangler.";
  }

  if (message.includes("Ikke autoriseret")) {
    return "Du er ikke logget ind længere. Genindlæs siden og log ind igen.";
  }

  if (message.includes("Manual action timed out")) {
    return "Sync-svaret kom ikke tilbage i tide. Prøv igen om et øjeblik.";
  }

  return message || "Ukendt fejl";
}

async function request(url: string, options?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MANUAL_ACTION_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options?.headers ?? {}),
      },
      signal: controller.signal,
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? "Kaldet fejlede");
    }

    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Manual action timed out");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function InternalActions({
  syncReady,
  disabledReason,
}: {
  syncReady: boolean;
  disabledReason?: string | null;
}) {
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [state, setState] = useState<ActionState>(null);
  const buttonsDisabled = pendingLabel !== null || !syncReady;

  async function run(label: string, url: string, options?: RequestInit) {
    setPendingLabel(label);
    setState(null);

    try {
      const payload = await request(url, options);
      setState({
        label,
        output: JSON.stringify(payload, null, 2),
        error: false,
      });
    } catch (error) {
      setState({
        label,
        output: toUiErrorMessage(error),
        error: true,
      });
    } finally {
      setPendingLabel(null);
    }
  }

  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Manuelle handlinger</p>
          <h2>Probe og sync</h2>
        </div>
        <p className="muted">"Sync" kører den fulde daglige sync (baseline + sync) — samme sekvens som den automatiske kl. 16:00. De øvrige knapper er til fejlsøgning.</p>
      </div>

      {disabledReason ? <p className="flash flash--error action-note">{disabledReason}</p> : null}

      <div className="action-row">
        <button
          className="button button--accent"
          disabled={buttonsDisabled}
          onClick={() => run("Sync", "/api/sync/full", { method: "POST" })}
          type="button"
          title="Kører baseline + sync — samme sekvens som den automatiske daglige sync"
        >
          {pendingLabel === "Sync" ? "Kører..." : "Sync"}
        </button>
        <button className="button button--ghost" disabled={buttonsDisabled} onClick={() => run("Probe API", "/api/sync/probe")} type="button">
          {pendingLabel === "Probe API" ? "Kører..." : "Probe API"}
        </button>
        <button
          className="button button--ghost"
          disabled={buttonsDisabled}
          onClick={() =>
            run("Opret dagens baseline", "/api/sync/manual", {
              method: "POST",
              body: JSON.stringify({ mode: "baseline" }),
            })
          }
          type="button"
        >
          {pendingLabel === "Opret dagens baseline" ? "Kører..." : "Opret dagens baseline"}
        </button>
        <button
          className="button button--ghost"
          disabled={buttonsDisabled}
          onClick={() =>
            run("Backfill betalinger (7 dage)", "/api/sync/manual", {
              method: "POST",
              body: JSON.stringify({ mode: "payments_backfill", days: 7 }),
            })
          }
          type="button"
        >
          {pendingLabel === "Backfill betalinger (7 dage)" ? "Kører..." : "Backfill betalinger (7 dage)"}
        </button>
        <button
          className="button button--ghost"
          disabled={buttonsDisabled}
          onClick={() =>
            run("Kør kun sync", "/api/sync/manual", {
              method: "POST",
              body: JSON.stringify({ mode: "sync" }),
            })
          }
          type="button"
        >
          {pendingLabel === "Kør kun sync" ? "Kører..." : "Kør kun sync"}
        </button>
      </div>
      <div className={`response-box ${state?.error ? "response-box--error" : ""}`}>
        <p className="response-box__label">{state?.label ?? "Svar"}</p>
        <pre>{state?.output ?? "Kør en handling for at se resultatet her."}</pre>
      </div>
    </section>
  );
}

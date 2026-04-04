"use client";

import { useState } from "react";

type ActionState = {
  label: string;
  output: string;
  error: boolean;
} | null;

async function request(url: string, options?: RequestInit) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed");
  }

  return payload;
}

export function InternalActions() {
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [state, setState] = useState<ActionState>(null);

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
        output: error instanceof Error ? error.message : "Unknown error",
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
          <p className="eyebrow">Manual ops</p>
          <h2>Probe and sync</h2>
        </div>
        <p className="muted">Phase 1 stays manual until the live API contract is confirmed.</p>
      </div>
      <div className="action-row">
        <button
          className="button"
          disabled={pendingLabel !== null}
          onClick={() => run("Probe API", "/api/sync/probe")}
          type="button"
        >
          {pendingLabel === "Probe API" ? "Running..." : "Probe API"}
        </button>
        <button
          className="button button--ghost"
          disabled={pendingLabel !== null}
          onClick={() =>
            run("Seed Today Baseline", "/api/sync/manual", {
              method: "POST",
              body: JSON.stringify({ mode: "baseline" }),
            })
          }
          type="button"
        >
          {pendingLabel === "Seed Today Baseline" ? "Running..." : "Seed Today Baseline"}
        </button>
        <button
          className="button button--accent"
          disabled={pendingLabel !== null}
          onClick={() =>
            run("Sync Now", "/api/sync/manual", {
              method: "POST",
              body: JSON.stringify({ mode: "sync" }),
            })
          }
          type="button"
        >
          {pendingLabel === "Sync Now" ? "Running..." : "Sync Now"}
        </button>
      </div>
      <div className={`response-box ${state?.error ? "response-box--error" : ""}`}>
        <p className="response-box__label">{state?.label ?? "Response"}</p>
        <pre>{state?.output ?? "Run a probe or sync action to inspect the result."}</pre>
      </div>
    </section>
  );
}

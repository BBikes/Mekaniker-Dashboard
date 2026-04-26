"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

export const dynamic = "force-dynamic";

// ─── Types ────────────────────────────────────────────────────────────────────

type Mechanic = {
  id: string;
  name: string;
  sku: string;
  display_order: number;
  active: boolean;
  daily_target_quarters: number;
};

type MechanicRow = Mechanic & { _dirty: boolean; _saving: boolean };

type BoardType = "today" | "yesterday" | "current_week" | "current_month";

type BoardSetting = {
  board_type: BoardType;
  active: boolean;
  label: string;
  sort_order: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  return `mech_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const BOARD_DESCRIPTIONS: Record<BoardType, string> = {
  today:         "Viser dagens kvarterer (kræver at sync er kørt i dag).",
  yesterday:     "Viser gårsdagens kvarterer.",
  current_week:  "Viser kvarterer fra mandag til i går.",
  current_month: "Viser kvarterer fra den 1. i måneden til i går.",
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  // Mechanics state
  const [mechanics, setMechanics] = useState<MechanicRow[]>([]);
  const [mechanicsLoading, setMechanicsLoading] = useState(true);
  const [mechanicsError, setMechanicsError] = useState<string | null>(null);
  const [mechanicsSaving, setMechanicsSaving] = useState(false);
  const [mechanicsSaveMsg, setMechanicsSaveMsg] = useState<string | null>(null);

  // Board settings state
  const [boards, setBoards] = useState<BoardSetting[]>([]);
  const [boardsLoading, setBoardsLoading] = useState(true);
  const [boardsSaving, setBoardsSaving] = useState(false);
  const [boardsSaveMsg, setBoardsSaveMsg] = useState<string | null>(null);

  // ─── Fetch mechanics ──────────────────────────────────────────────────────

  const fetchMechanics = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/mechanics");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as Mechanic[];
      setMechanics(json.map((m) => ({ ...m, _dirty: false, _saving: false })));
      setMechanicsError(null);
    } catch (e) {
      setMechanicsError(e instanceof Error ? e.message : "Fejl");
    } finally {
      setMechanicsLoading(false);
    }
  }, []);

  // ─── Fetch board settings ─────────────────────────────────────────────────

  const fetchBoards = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/boards");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as BoardSetting[];
      setBoards(json.sort((a, b) => a.sort_order - b.sort_order));
    } catch {
      // Silently fall back to empty — boards will show defaults
    } finally {
      setBoardsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchMechanics();
    void fetchBoards();
  }, [fetchMechanics, fetchBoards]);

  // ─── Mechanic actions ─────────────────────────────────────────────────────

  function updateRow(id: string, field: keyof Mechanic, value: unknown) {
    setMechanics((prev) =>
      prev.map((m) => (m.id === id ? { ...m, [field]: value, _dirty: true } : m)),
    );
  }

  function addMechanic() {
    const newMechanic: MechanicRow = {
      id: generateId(),
      name: "",
      sku: "",
      display_order: mechanics.length + 1,
      active: true,
      daily_target_quarters: 30,
      _dirty: true,
      _saving: false,
    };
    setMechanics((prev) => [...prev, newMechanic]);
  }

  async function saveMechanics() {
    const dirty = mechanics.filter((m) => m._dirty);
    if (dirty.length === 0) {
      setMechanicsSaveMsg("Ingen ændringer at gemme.");
      setTimeout(() => setMechanicsSaveMsg(null), 3000);
      return;
    }

    setMechanicsSaving(true);
    setMechanicsSaveMsg(null);

    try {
      const res = await fetch("/api/settings/mechanics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dirty.map(({ _dirty: _d, _saving: _s, ...m }) => m)),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      setMechanics((prev) => prev.map((m) => ({ ...m, _dirty: false })));
      setMechanicsSaveMsg("Gemt!");
      setTimeout(() => setMechanicsSaveMsg(null), 3000);
    } catch (e) {
      setMechanicsSaveMsg(`Fejl: ${e instanceof Error ? e.message : "Ukendt fejl"}`);
    } finally {
      setMechanicsSaving(false);
    }
  }

  async function deleteMechanic(id: string) {
    if (!confirm("Er du sikker på at du vil slette denne mekaniker?")) return;
    try {
      const res = await fetch(`/api/settings/mechanics/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMechanics((prev) => prev.filter((m) => m.id !== id));
    } catch (e) {
      alert(`Fejl ved sletning: ${e instanceof Error ? e.message : "Ukendt fejl"}`);
    }
  }

  // ─── Board actions ────────────────────────────────────────────────────────

  function toggleBoard(boardType: BoardType) {
    setBoards((prev) =>
      prev.map((b) => (b.board_type === boardType ? { ...b, active: !b.active } : b)),
    );
  }

  async function saveBoards() {
    setBoardsSaving(true);
    setBoardsSaveMsg(null);
    try {
      const res = await fetch("/api/settings/boards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(boards),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      setBoardsSaveMsg("Gemt!");
      setTimeout(() => setBoardsSaveMsg(null), 3000);
    } catch (e) {
      setBoardsSaveMsg(`Fejl: ${e instanceof Error ? e.message : "Ukendt fejl"}`);
    } finally {
      setBoardsSaving(false);
    }
  }

  const dirtyMechanicsCount = mechanics.filter((m) => m._dirty).length;

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <main className="page-shell">
      <div className="hero">
        <div className="hero__top">
          <div>
            <p className="eyebrow">B-Bikes</p>
            <h1>Indstillinger</h1>
          </div>
        </div>
        <p className="muted">
          Administrer mekanikere, varenumre, daglige mål og TV-dashboard boards.
        </p>
      </div>

      <nav className="nav">
        <Link href="/" className="nav__link">Kontrolpanel</Link>
        <Link href="/reports" className="nav__link">Rapporter</Link>
        <span className="nav__link nav__link--active">Indstillinger</span>
        <Link href="/dashboard" className="nav__link" target="_blank">TV-dashboard ↗</Link>
      </nav>

      {/* ── Mechanics panel ── */}
      {mechanicsLoading && <p className="muted">Indlæser mekanikere…</p>}

      {mechanicsError && (
        <div className="response-box response-box--error" style={{ marginBottom: "24px" }}>
          <p className="response-box__label">Fejl</p>
          <pre>{mechanicsError}</pre>
        </div>
      )}

      {!mechanicsLoading && (
        <div className="panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
            <div>
              <p className="eyebrow">Mekanikere</p>
              <p className="muted" style={{ fontSize: "0.85rem", margin: "4px 0 0" }}>
                Mål beregnes automatisk som dagligt mål × antal arbejdsdage i perioden.
              </p>
            </div>
            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              {mechanicsSaveMsg && (
                <span style={{
                  fontSize: "0.9rem",
                  color: mechanicsSaveMsg.startsWith("Fejl") ? "#dc2626" : "#059669",
                  fontWeight: 600,
                }}>
                  {mechanicsSaveMsg}
                </span>
              )}
              <button className="button button--ghost" onClick={addMechanic}>
                + Tilføj mekaniker
              </button>
              <button
                className="button button--accent"
                onClick={() => void saveMechanics()}
                disabled={mechanicsSaving || dirtyMechanicsCount === 0}
              >
                {mechanicsSaving ? "Gemmer…" : dirtyMechanicsCount > 0 ? `Gem (${dirtyMechanicsCount})` : "Gem"}
              </button>
            </div>
          </div>

          {/* Column headers */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "2fr 1.5fr 80px 80px 40px 40px",
            gap: "12px",
            padding: "8px 0 4px",
            borderBottom: "2px solid var(--line)",
          }}>
            {["Navn", "Varenummer (SKU)", "Mål/dag", "Rækkefølge", "Aktiv", ""].map((h, i) => (
              <span key={i} style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                {h}
              </span>
            ))}
          </div>

          {mechanics.map((m) => (
            <div
              key={m.id}
              className="mechanic-row"
              style={{
                gridTemplateColumns: "2fr 1.5fr 80px 80px 40px 40px",
                opacity: m.active ? 1 : 0.55,
              }}
            >
              <input
                type="text"
                value={m.name}
                placeholder="Navn"
                onChange={(e) => updateRow(m.id, "name", e.target.value)}
              />
              <input
                type="text"
                value={m.sku}
                placeholder="f.eks. 2403B15"
                onChange={(e) => updateRow(m.id, "sku", e.target.value.toUpperCase())}
                style={{ fontFamily: "monospace" }}
              />
              <input
                type="number"
                value={m.daily_target_quarters}
                min={0}
                max={100}
                onChange={(e) => updateRow(m.id, "daily_target_quarters", parseInt(e.target.value) || 0)}
              />
              <input
                type="number"
                value={m.display_order}
                min={1}
                max={99}
                onChange={(e) => updateRow(m.id, "display_order", parseInt(e.target.value) || 1)}
              />
              <input
                type="checkbox"
                checked={m.active}
                onChange={(e) => updateRow(m.id, "active", e.target.checked)}
              />
              <button
                className="button button--danger"
                style={{ padding: "6px 10px", fontSize: "0.8rem" }}
                onClick={() => void deleteMechanic(m.id)}
                title="Slet mekaniker"
              >
                ✕
              </button>
            </div>
          ))}

          {mechanics.length === 0 && (
            <p className="muted" style={{ textAlign: "center", padding: "24px 0" }}>
              Ingen mekanikere endnu. Klik &quot;+ Tilføj mekaniker&quot; for at komme i gang.
            </p>
          )}
        </div>
      )}

      {/* ── Board settings panel ── */}
      <div className="panel" style={{ marginTop: "24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <p className="eyebrow">TV-dashboard &amp; Rapporter</p>
            <h2 style={{ margin: "4px 0 0" }}>Boards og visning</h2>
            <p className="muted" style={{ fontSize: "0.85rem", margin: "4px 0 0" }}>
              Vælg hvilke perioder der vises på TV-dashboardet og i rapporter. Aktive boards roterer i rækkefølge.
            </p>
          </div>
          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            {boardsSaveMsg && (
              <span style={{
                fontSize: "0.9rem",
                color: boardsSaveMsg.startsWith("Fejl") ? "#dc2626" : "#059669",
                fontWeight: 600,
              }}>
                {boardsSaveMsg}
              </span>
            )}
            <button
              className="button button--accent"
              onClick={() => void saveBoards()}
              disabled={boardsSaving || boardsLoading}
            >
              {boardsSaving ? "Gemmer…" : "Gem boards"}
            </button>
          </div>
        </div>

        {boardsLoading && <p className="muted" style={{ marginTop: "16px" }}>Indlæser boards…</p>}

        {!boardsLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "16px" }}>
            {boards.map((board) => (
              <div
                key={board.board_type}
                className="status-item"
                style={{
                  padding: "14px 16px",
                  borderRadius: "8px",
                  border: "1px solid var(--line)",
                  background: board.active ? "var(--surface)" : "transparent",
                  opacity: board.active ? 1 : 0.6,
                  cursor: "pointer",
                  userSelect: "none",
                }}
                onClick={() => toggleBoard(board.board_type)}
              >
                <div className="status-item__label">
                  <strong>{board.label}</strong>
                  <p className="muted" style={{ fontSize: "0.85rem", margin: "2px 0 0" }}>
                    {BOARD_DESCRIPTIONS[board.board_type]}
                  </p>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  {board.active ? (
                    <span className="pill pill--ok">Aktiv</span>
                  ) : (
                    <span className="pill" style={{ background: "var(--line)", color: "var(--muted)" }}>Inaktiv</span>
                  )}
                  <input
                    type="checkbox"
                    checked={board.active}
                    onChange={() => toggleBoard(board.board_type)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ width: "18px", height: "18px", cursor: "pointer" }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Info box ── */}
      <div className="panel" style={{ marginTop: "24px" }}>
        <p className="eyebrow">Vejledning</p>
        <h2>Sådan fungerer det</h2>
        <div className="status-list">
          <div className="status-item">
            <div className="status-item__label">
              <strong>Varenummer (SKU)</strong>
              <p className="muted" style={{ fontSize: "0.85rem" }}>
                Det varenummer mekanikeren bruger i BikeDesk til at registrere påbegyndte 15 min. F.eks. <code>2403B15</code>.
              </p>
            </div>
          </div>
          <div className="status-item">
            <div className="status-item__label">
              <strong>Dagligt mål</strong>
              <p className="muted" style={{ fontSize: "0.85rem" }}>
                Antal kvarterer pr. arbejdsdag. 30 kvarterer = 7,5 timer. Bruges til mållinjen på TV-dashboardet og opfyldelsesprocenten i rapporter.
              </p>
            </div>
          </div>
          <div className="status-item">
            <div className="status-item__label">
              <strong>I dag-board</strong>
              <p className="muted" style={{ fontSize: "0.85rem" }}>
                Viser data fra den seneste sync-kørsel i dag. Kør en manuel sync fra kontrolpanelet for at opdatere.
              </p>
            </div>
          </div>
          <div className="status-item">
            <div className="status-item__label">
              <strong>Automatisk sync</strong>
              <p className="muted" style={{ fontSize: "0.85rem" }}>
                Data synkroniseres automatisk kl. 16:00 hver dag. Du kan også køre en manuel sync fra kontrolpanelet.
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

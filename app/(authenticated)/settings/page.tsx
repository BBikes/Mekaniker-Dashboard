"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

export const dynamic = "force-dynamic";

type Mechanic = {
  id: string;
  name: string;
  sku: string;
  display_order: number;
  active: boolean;
  daily_target_quarters: number;
};

type MechanicRow = Mechanic & { _dirty: boolean; _saving: boolean };

function generateId(): string {
  return `mech_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function SettingsPage() {
  const [mechanics, setMechanics] = useState<MechanicRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [globalSaving, setGlobalSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const fetchMechanics = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/mechanics");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as Mechanic[];
      setMechanics(json.map((m) => ({ ...m, _dirty: false, _saving: false })));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fejl");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchMechanics();
  }, [fetchMechanics]);

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

  async function saveAll() {
    const dirty = mechanics.filter((m) => m._dirty);
    if (dirty.length === 0) {
      setSaveMessage("Ingen ændringer at gemme.");
      setTimeout(() => setSaveMessage(null), 3000);
      return;
    }

    setGlobalSaving(true);
    setSaveMessage(null);

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
      setSaveMessage("Gemt!");
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (e) {
      setSaveMessage(`Fejl: ${e instanceof Error ? e.message : "Ukendt fejl"}`);
    } finally {
      setGlobalSaving(false);
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

  const dirtyCount = mechanics.filter((m) => m._dirty).length;

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
          Administrer mekanikere, varenumre og daglige mål. Mål angives i antal påbegyndte 15-minutters enheder pr. dag.
        </p>
      </div>

      <nav className="nav">
        <Link href="/" className="nav__link">Kontrolpanel</Link>
        <Link href="/reports" className="nav__link">Rapporter</Link>
        <span className="nav__link nav__link--active">Indstillinger</span>
        <Link href="/dashboard" className="nav__link" target="_blank">TV-dashboard ↗</Link>
      </nav>

      {loading && <p className="muted">Indlæser…</p>}

      {error && (
        <div className="response-box response-box--error" style={{ marginBottom: "24px" }}>
          <p className="response-box__label">Fejl</p>
          <pre>{error}</pre>
        </div>
      )}

      {!loading && (
        <div className="panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
            <div>
              <p className="eyebrow">Mekanikere</p>
              <p className="muted" style={{ fontSize: "0.85rem", margin: "4px 0 0" }}>
                Mål beregnes automatisk som dagligt mål × antal arbejdsdage i perioden.
              </p>
            </div>
            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              {saveMessage && (
                <span style={{
                  fontSize: "0.9rem",
                  color: saveMessage.startsWith("Fejl") ? "#dc2626" : "#059669",
                  fontWeight: 600
                }}>
                  {saveMessage}
                </span>
              )}
              <button className="button button--ghost" onClick={addMechanic}>
                + Tilføj mekaniker
              </button>
              <button
                className="button button--accent"
                onClick={() => void saveAll()}
                disabled={globalSaving || dirtyCount === 0}
              >
                {globalSaving ? "Gemmer…" : dirtyCount > 0 ? `Gem (${dirtyCount})` : "Gem"}
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

      {/* Info box */}
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

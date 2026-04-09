import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { getDashboardViewSettings } from "@/lib/data/dashboard";
import { createAdminClient } from "@/lib/supabase/server";
import { getDashboardReadinessMessage, getEnvPresence, toOperatorErrorMessage } from "@/lib/env";

import {
  saveSettingsAction,
} from "./actions";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const env = getEnvPresence();
  const params = await searchParams;
  const message = typeof params.message === "string" ? params.message : null;
  const kind = typeof params.kind === "string" ? params.kind : null;

  if (!env.dashboardReady) {
    return (
      <>
        <AppHeader activeHref="/settings" />
        <main className="page-shell">
          <section className="panel">
            <p className="eyebrow">Indstillinger utilgængelige</p>
            <h2>Serverdata er ikke klar</h2>
            <p className="muted">{getDashboardReadinessMessage(env) ?? "Supabase er ikke konfigureret korrekt."}</p>
            <p className="inline-links">
              <Link href="/">Tilbage til kontrolpanel</Link>
            </p>
          </section>
        </main>
      </>
    );
  }

  let mechanics: Array<{
    id: string;
    mechanic_name: string;
    mechanic_item_no: string;
    display_order: number;
    active: boolean;
  }> = [];
  let dashboardViews: Awaited<ReturnType<typeof getDashboardViewSettings>> = [];
  let loadError: string | null = null;

  try {
    const supabase = createAdminClient();
    const [{ data, error }, views] = await Promise.all([
      supabase
        .from("mechanic_item_mapping")
        .select("id, mechanic_name, mechanic_item_no, display_order, active")
        .order("display_order", { ascending: true })
        .order("mechanic_name", { ascending: true }),
      getDashboardViewSettings(),
    ]);

    if (error) {
      throw error;
    }

    mechanics = (data ?? []) as typeof mechanics;
    dashboardViews = views;
  } catch (error) {
    loadError = toOperatorErrorMessage(error, "Kunne ikke hente mekanikeropsætning.");
  }

  return (
    <>
      <AppHeader activeHref="/settings" />
      <main className="page-shell">
        <section className="hero">
          <div className="hero__top">
            <div>
              <p className="eyebrow">Indstillinger</p>
              <h1>Mekanikere og TV-boards</h1>
            </div>
          </div>
          <p>Vedligehold mappings for mekanikere og styr hvilke dashboards TV-visningen roterer igennem.</p>
        </section>

        {message ? <p className={`flash ${kind === "success" ? "flash--success" : "flash--error"}`}>{message}</p> : null}
        {loadError ? <p className="flash flash--error">{loadError}</p> : null}

        <form action={saveSettingsAction} className="settings-page-form">
          <div className="settings-page-actions">
            <button className="button button--accent" type="submit">
              Gem ændringer
            </button>
          </div>

          <section className="panel settings-panel">
            <div className="panel__header">
              <div>
                <p className="eyebrow">Ny mekaniker</p>
                <h2>Tilføj mapping</h2>
              </div>
              <p className="muted">Varenummeret skal matche den mekanikerlinje, der registreres på arbejdskortet.</p>
            </div>
            <div className="settings-form-grid">
              <div className="field">
                <label htmlFor="new-mechanic-name">Navn</label>
                <input id="new-mechanic-name" name="new_mechanic_name" type="text" />
              </div>
              <div className="field">
                <label htmlFor="new-mechanic-item-no">Varenummer</label>
                <input id="new-mechanic-item-no" name="new_mechanic_item_no" type="text" />
              </div>
              <div className="field">
                <label htmlFor="new-display-order">Rækkefølge</label>
                <input defaultValue={mechanics.length} id="new-display-order" min="0" name="new_display_order" step="1" type="number" />
              </div>
              <label className="checkbox-field">
                <input defaultChecked name="new_active" type="checkbox" />
                Aktiv
              </label>
            </div>
          </section>

          <section className="panel">
            <div className="panel__header">
              <div>
                <p className="eyebrow">Eksisterende mappings</p>
                <h2>Vedligehold</h2>
              </div>
              <p className="muted">Mål beregnes automatisk som 7,5 timer mandag til torsdag, 7,0 timer fredag og 0 timer i weekender og på danske helligdage.</p>
            </div>

            {mechanics.length > 0 ? (
              <div className="table-wrap">
                <table className="settings-table">
                  <thead>
                    <tr>
                      <th>Navn</th>
                      <th>Varenummer</th>
                      <th>Rækkefølge</th>
                      <th>Aktiv</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mechanics.map((mechanic) => (
                      <tr key={mechanic.id}>
                        <td>
                          <input name="id" type="hidden" value={mechanic.id} />
                          <input defaultValue={mechanic.mechanic_name} name="mechanic_name" required type="text" />
                        </td>
                        <td>
                          <input defaultValue={mechanic.mechanic_item_no} name="mechanic_item_no" required type="text" />
                        </td>
                        <td>
                          <input defaultValue={mechanic.display_order} min="0" name="display_order" step="1" type="number" />
                        </td>
                        <td>
                          <input defaultChecked={mechanic.active} name="active_ids" type="checkbox" value={mechanic.id} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">Ingen mekanikere endnu. Opret den første mapping ovenfor for at gøre sync og dashboard brugbare.</p>
            )}
          </section>

          <section className="panel">
            <div className="panel__header">
              <div>
                <p className="eyebrow">TV-dashboard</p>
                <h2>Boards og rotation</h2>
              </div>
              <p className="muted">Aktive boards vises i rækkefølge på TV-siden. Varighed angives i sekunder.</p>
            </div>

            {dashboardViews.length > 0 ? (
              <div className="table-wrap">
                <table className="settings-table">
                  <thead>
                    <tr>
                      <th>Board</th>
                      <th>Varighed (sek.)</th>
                      <th>Rækkefølge</th>
                      <th>Aktiv</th>
                      <th>Valgte mekanikere</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboardViews.map((view) => {
                      const isFocusBoard = view.boardType === "mechanic_focus";

                      return (
                        <tr key={view.boardType}>
                          <td>
                            <input name="board_type" type="hidden" value={view.boardType} />
                            <input name="board_title" type="hidden" value={view.boardTitle} />
                            <strong>{view.boardTitle}</strong>
                          </td>
                          <td>
                            <input defaultValue={view.durationSeconds} min="5" name="duration_seconds" step="1" type="number" />
                          </td>
                          <td>
                            <input defaultValue={view.displayOrder} min="0" name="dashboard_display_order" step="1" type="number" />
                          </td>
                          <td>
                            <input defaultChecked={view.active} name="active_board_types" type="checkbox" value={view.boardType} />
                          </td>
                          <td>
                            {isFocusBoard ? (
                              <div className="settings-checklist">
                                {mechanics.map((mechanic) => (
                                  <label className="settings-checklist__item" key={mechanic.id}>
                                    <input
                                      defaultChecked={view.selectedMechanicIds.includes(mechanic.id)}
                                      name={`selected_mechanic_ids_${view.boardType}`}
                                      type="checkbox"
                                      value={mechanic.id}
                                    />
                                    <span>{mechanic.mechanic_name}</span>
                                  </label>
                                ))}
                              </div>
                            ) : (
                              <span className="muted">Bruger alle aktive mekanikere</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">Dashboard-opsætningen er ikke tilgængelig endnu.</p>
            )}
          </section>
        </form>
      </main>
    </>
  );
}

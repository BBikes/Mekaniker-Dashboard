import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { createAdminClient } from "@/lib/supabase/server";
import { getDashboardReadinessMessage, getEnvPresence, toOperatorErrorMessage } from "@/lib/env";

import { createMechanicAction, updateMechanicAction } from "./actions";

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
    daily_target_hours: number;
    display_order: number;
    active: boolean;
  }> = [];
  let loadError: string | null = null;

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("mechanic_item_mapping")
      .select("id, mechanic_name, mechanic_item_no, daily_target_hours, display_order, active")
      .order("display_order", { ascending: true })
      .order("mechanic_name", { ascending: true });

    if (error) {
      throw error;
    }

    mechanics = (data ?? []) as typeof mechanics;
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
              <h1>Mekanikere og varenummer</h1>
            </div>
          </div>
          <p>Vedligehold mappings for mekanikere, mål og rækkefølge direkte i appen.</p>
        </section>

        {message ? <p className={`flash ${kind === "success" ? "flash--success" : "flash--error"}`}>{message}</p> : null}
        {loadError ? <p className="flash flash--error">{loadError}</p> : null}

        <section className="panel settings-panel">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Ny mekaniker</p>
              <h2>Tilføj mapping</h2>
            </div>
            <p className="muted">Varenummeret skal matche den mekanikerlinje, der registreres på arbejdskortet.</p>
          </div>
          <form action={createMechanicAction} className="settings-form-grid">
            <div className="field">
              <label htmlFor="new-mechanic-name">Navn</label>
              <input id="new-mechanic-name" name="mechanic_name" required type="text" />
            </div>
            <div className="field">
              <label htmlFor="new-mechanic-item-no">Varenummer</label>
              <input id="new-mechanic-item-no" name="mechanic_item_no" required type="text" />
            </div>

            <div className="field">
              <label htmlFor="new-display-order">Rækkefølge</label>
              <input defaultValue={mechanics.length} id="new-display-order" min="0" name="display_order" step="1" type="number" />
            </div>
            <label className="checkbox-field">
              <input defaultChecked name="active" type="checkbox" />
              Aktiv
            </label>
            <button className="button button--accent" type="submit">
              Opret mekaniker
            </button>
          </form>
        </section>

        <section className="panel">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Eksisterende mappings</p>
              <h2>Vedligehold</h2>
            </div>
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
                    <th>Handling</th>
                  </tr>
                </thead>
                <tbody>
                  {mechanics.map((mechanic) => {
                    const formId = `mechanic-form-${mechanic.id}`;

                    return (
                      <tr key={mechanic.id}>
                        <td>
                          <input defaultValue={mechanic.mechanic_name} form={formId} name="mechanic_name" required type="text" />
                        </td>
                        <td>
                          <input defaultValue={mechanic.mechanic_item_no} form={formId} name="mechanic_item_no" required type="text" />
                        </td>

                        <td>
                          <input defaultValue={mechanic.display_order} form={formId} min="0" name="display_order" step="1" type="number" />
                        </td>
                        <td>
                          <input defaultChecked={mechanic.active} form={formId} name="active" type="checkbox" />
                        </td>
                        <td>
                          <form action={updateMechanicAction} id={formId}>
                            <input name="id" type="hidden" value={mechanic.id} />
                            <button className="button button--ghost" type="submit">
                              Gem
                            </button>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">Ingen mekanikere endnu. Opret den første mapping ovenfor for at gøre sync og dashboard brugbare.</p>
          )}
        </section>
      </main>
    </>
  );
}

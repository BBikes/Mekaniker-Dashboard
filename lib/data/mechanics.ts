import { createAdminClient } from "@/lib/supabase/server";
import type { Mechanic } from "@/lib/sync/bikedesk";

export type { Mechanic };

export async function getMechanics(onlyActive = false): Promise<Mechanic[]> {
  const db = createAdminClient();
  let query = db
    .from("mechanics")
    .select("id, name, sku, display_order, active, daily_target_quarters")
    .order("display_order", { ascending: true });

  if (onlyActive) {
    query = query.eq("active", true);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch mechanics: ${error.message}`);
  return (data ?? []) as Mechanic[];
}

export async function upsertMechanic(mechanic: Partial<Mechanic> & { id?: string }): Promise<void> {
  const db = createAdminClient();
  const { error } = await db.from("mechanics").upsert(mechanic, { onConflict: "id" });
  if (error) throw new Error(`Failed to upsert mechanic: ${error.message}`);
}

export async function deleteMechanic(id: string): Promise<void> {
  const db = createAdminClient();
  const { error } = await db.from("mechanics").delete().eq("id", id);
  if (error) throw new Error(`Failed to delete mechanic: ${error.message}`);
}

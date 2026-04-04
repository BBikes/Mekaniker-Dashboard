import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { formatCopenhagenDate, getCopenhagenDateString } from "@/lib/time";

type TotalRow = {
  mechanic_id: string;
  hours_total: number;
  quarters_total: number;
};

export async function getDashboardData() {
  const supabase = createAdminClient();
  const statDate = getCopenhagenDateString();

  const [{ data: mappings, error: mappingsError }, { data: totals, error: totalsError }, { data: latestSync, error: syncError }] =
    await Promise.all([
      supabase
        .from("mechanic_item_mapping")
        .select("id, mechanic_name, display_order, daily_target_hours")
        .eq("active", true)
        .order("display_order", { ascending: true })
        .order("mechanic_name", { ascending: true }),
      supabase
        .from("daily_mechanic_totals")
        .select("mechanic_id, hours_total, quarters_total")
        .eq("stat_date", statDate),
      supabase
        .from("sync_event_log")
        .select("finished_at, status, sync_type, message")
        .in("sync_type", ["baseline", "sync"])
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  if (mappingsError) {
    throw new Error(`Failed to load mechanic mappings: ${mappingsError.message}`);
  }

  if (totalsError) {
    throw new Error(`Failed to load dashboard totals: ${totalsError.message}`);
  }

  if (syncError) {
    throw new Error(`Failed to load latest sync: ${syncError.message}`);
  }

  const totalsByMechanic = new Map((totals ?? []).map((row) => [row.mechanic_id as string, row as TotalRow]));
  const rows = (mappings ?? []).map((mapping) => {
    const total = totalsByMechanic.get(mapping.id as string);
    return {
      id: mapping.id as string,
      mechanicName: mapping.mechanic_name as string,
      targetHours: Number(mapping.daily_target_hours ?? 8),
      hours: Number(total?.hours_total ?? 0),
      quarters: Number(total?.quarters_total ?? 0),
    };
  });

  return {
    statDate,
    statDateLabel: formatCopenhagenDate(statDate),
    rows,
    latestSync: latestSync
      ? {
          finishedAt: latestSync.finished_at as string | null,
          status: latestSync.status as string,
          mode: latestSync.sync_type as string,
          message: latestSync.message as string | null,
        }
      : null,
  };
}

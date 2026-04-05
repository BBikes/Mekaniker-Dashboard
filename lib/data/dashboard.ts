import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { formatCopenhagenDate, getCopenhagenDateString } from "@/lib/time";

type TotalRow = {
  mechanic_id: string;
  hours_total: number;
  quarters_total: number;
};

export type DashboardLatestSync = {
  finishedAt: string | null;
  status: string;
  mode: string;
  message: string | null;
  refreshToken: string | null;
};

function toLatestSync(row: {
  finished_at?: string | null;
  status?: string | null;
  sync_type?: string | null;
  message?: string | null;
} | null): DashboardLatestSync | null {
  if (!row) {
    return null;
  }

  const finishedAt = row.finished_at ?? null;
  const status = row.status ?? "unknown";
  const mode = row.sync_type ?? "unknown";
  const message = row.message ?? null;

  return {
    finishedAt,
    status,
    mode,
    message,
    refreshToken: finishedAt ? `${mode}:${status}:${finishedAt}` : `${mode}:${status}:pending`,
  };
}

export async function getLatestDashboardSync() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("sync_event_log")
    .select("finished_at, status, sync_type, message")
    .eq("sync_type", "sync")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load latest sync: ${error.message}`);
  }

  return toLatestSync(data);
}

export async function getDashboardData() {
  const supabase = createAdminClient();
  const statDate = getCopenhagenDateString();

  const [{ data: mappings, error: mappingsError }, { data: totals, error: totalsError }, latestSync] =
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
      getLatestDashboardSync(),
    ]);

  if (mappingsError) {
    throw new Error(`Failed to load mechanic mappings: ${mappingsError.message}`);
  }

  if (totalsError) {
    throw new Error(`Failed to load dashboard totals: ${totalsError.message}`);
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
    latestSync,
  };
}

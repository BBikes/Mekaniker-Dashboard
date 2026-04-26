/**
 * Fetches and aggregates daily_totals from Supabase.
 *
 * Three periods (all end at yesterday — data is only reliable after 16:00 sync):
 * - yesterday: single day
 * - current_week: Monday → yesterday
 * - current_month: 1st of month → yesterday
 */

import { createAdminClient } from "@/lib/supabase/server";
import type { Mechanic } from "@/lib/data/mechanics";

export type PeriodTotals = {
  mechanic_id: string;
  quarters: number;
};

export type DashboardData = {
  yesterday: PeriodTotals[];
  current_week: PeriodTotals[];
  current_month: PeriodTotals[];
  lastSyncAt: string | null;
  lastSyncDate: string | null;
};

/**
 * Returns date strings for the three periods, relative to "today" in Copenhagen time.
 * All periods end at yesterday (inclusive).
 */
export function getPeriodDates(now?: Date): {
  yesterday: string;
  weekStart: string;
  monthStart: string;
} {
  // Use Copenhagen time (UTC+2 in summer, UTC+1 in winter)
  // We use a simple offset: if the server is UTC, add 2h for CEST
  const d = now ?? new Date();

  // Get Copenhagen date
  const copenhagenOffset = 2; // CEST (summer) — adjust if needed
  const local = new Date(d.getTime() + copenhagenOffset * 60 * 60 * 1000);

  const todayStr = local.toISOString().slice(0, 10);
  const todayDate = new Date(todayStr);

  // Yesterday
  const yd = new Date(todayDate);
  yd.setDate(yd.getDate() - 1);
  const yesterday = yd.toISOString().slice(0, 10);

  // Start of current week (Monday)
  const dow = todayDate.getDay(); // 0=Sun, 1=Mon, ...
  const daysFromMonday = dow === 0 ? 6 : dow - 1;
  const ws = new Date(todayDate);
  ws.setDate(ws.getDate() - daysFromMonday);
  const weekStart = ws.toISOString().slice(0, 10);

  // Start of current month
  const monthStart = `${todayStr.slice(0, 7)}-01`;

  return { yesterday, weekStart, monthStart };
}

export async function getDashboardData(mechanics: Mechanic[]): Promise<DashboardData> {
  const db = createAdminClient();
  const { yesterday, weekStart, monthStart } = getPeriodDates();

  // Fetch all rows from the earliest needed date to yesterday
  const { data, error } = await db
    .from("daily_totals")
    .select("mechanic_id, work_date, quarters")
    .gte("work_date", monthStart)
    .lte("work_date", yesterday);

  if (error) throw new Error(`Failed to fetch daily_totals: ${error.message}`);

  const rows = (data ?? []) as { mechanic_id: string; work_date: string; quarters: number }[];

  // Aggregate per period
  const aggregate = (from: string, to: string): PeriodTotals[] => {
    const totals = new Map<string, number>();
    for (const m of mechanics) totals.set(m.id, 0);

    for (const row of rows) {
      if (row.work_date >= from && row.work_date <= to) {
        totals.set(row.mechanic_id, (totals.get(row.mechanic_id) ?? 0) + row.quarters);
      }
    }

    return Array.from(totals.entries()).map(([mechanic_id, quarters]) => ({
      mechanic_id,
      quarters,
    }));
  };

  // Fetch last sync info
  const { data: logData } = await db
    .from("sync_log")
    .select("finished_at, status")
    .eq("status", "completed")
    .order("finished_at", { ascending: false })
    .limit(1)
    .single();

  return {
    yesterday: aggregate(yesterday, yesterday),
    current_week: aggregate(weekStart, yesterday),
    current_month: aggregate(monthStart, yesterday),
    lastSyncAt: logData?.finished_at ?? null,
    lastSyncDate: yesterday,
  };
}

/**
 * Compute the target (in quarters) for a period based on working days.
 * Working days = Mon–Fri, excluding Danish public holidays (simplified: no holiday check).
 */
export function computeTarget(
  mechanic: Mechanic,
  fromDate: string,
  toDate: string,
): number {
  let workDays = 0;
  const cur = new Date(fromDate);
  const end = new Date(toDate);

  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) workDays++; // Mon–Fri
    cur.setDate(cur.getDate() + 1);
  }

  return workDays * mechanic.daily_target_quarters;
}

/**
 * Fetches and aggregates daily_totals from Supabase.
 *
 * Four periods:
 * - today:         today (data from the most recent sync run today)
 * - yesterday:     yesterday
 * - current_week:  Monday → yesterday
 * - current_month: 1st of month → yesterday
 *
 * Note: "today" only has data after a sync has been run (manual or 16:00 auto).
 */

import { createAdminClient } from "@/lib/supabase/server";
import type { Mechanic } from "@/lib/data/mechanics";

export type PeriodTotals = {
  mechanic_id: string;
  quarters: number;
};

export type DashboardData = {
  today: PeriodTotals[];
  yesterday: PeriodTotals[];
  current_week: PeriodTotals[];
  current_month: PeriodTotals[];
  lastSyncAt: string | null;
  lastSyncDate: string | null;
};

/**
 * Returns date strings for all four periods, relative to "today" in Copenhagen time.
 */
export function getPeriodDates(now?: Date): {
  today: string;
  yesterday: string;
  weekStart: string;
  monthStart: string;
} {
  // Use Copenhagen time (UTC+2 in summer, UTC+1 in winter)
  const d = now ?? new Date();
  const copenhagenOffset = 2; // CEST (summer)
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

  return { today: todayStr, yesterday, weekStart, monthStart };
}

export async function getDashboardData(mechanics: Mechanic[]): Promise<DashboardData> {
  const db = createAdminClient();
  const { today, yesterday, weekStart, monthStart } = getPeriodDates();

  // Fetch all rows from the earliest needed date to today (inclusive)
  const { data, error } = await db
    .from("daily_totals")
    .select("mechanic_id, work_date, quarters")
    .gte("work_date", monthStart)
    .lte("work_date", today);

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
    today: aggregate(today, today),
    yesterday: aggregate(yesterday, yesterday),
    current_week: aggregate(weekStart, yesterday),
    current_month: aggregate(monthStart, yesterday),
    lastSyncAt: logData?.finished_at ?? null,
    lastSyncDate: yesterday,
  };
}

/**
 * Compute the target (in quarters) for a period based on working days.
 * Working days = Mon–Fri (no Danish public holiday check).
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
    if (dow !== 0 && dow !== 6) workDays++;
    cur.setDate(cur.getDate() + 1);
  }

  return workDays * mechanic.daily_target_quarters;
}

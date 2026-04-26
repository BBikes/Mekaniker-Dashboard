/**
 * GET /api/reports/tickets?mechanic_id=...&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns the union of all ticket IDs for a mechanic across the given date range.
 * Used by the reports page when clicking a mechanic name.
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/server-auth";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const mechanicId = searchParams.get("mechanic_id");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!mechanicId || !from || !to) {
    return NextResponse.json(
      { error: "Missing required params: mechanic_id, from, to" },
      { status: 400 },
    );
  }

  const db = createAdminClient();

  const { data, error } = await db
    .from("daily_totals")
    .select("work_date, ticket_ids")
    .eq("mechanic_id", mechanicId)
    .gte("work_date", from)
    .lte("work_date", to)
    .order("work_date");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Merge all ticket IDs across the date range, deduplicate, sort
  const allTicketIds = new Set<number>();
  const byDate: Record<string, number[]> = {};

  for (const row of data ?? []) {
    const ids = (row.ticket_ids as number[]) ?? [];
    byDate[row.work_date as string] = ids;
    for (const id of ids) allTicketIds.add(id);
  }

  return NextResponse.json({
    mechanic_id: mechanicId,
    from,
    to,
    ticket_ids: Array.from(allTicketIds).sort((a, b) => a - b),
    by_date: byDate,
    total: allTicketIds.size,
  });
}

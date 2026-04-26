import { NextResponse } from "next/server";
import { getMechanics } from "@/lib/data/mechanics";
import { getDashboardData, getPeriodDates } from "@/lib/data/totals";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const mechanics = await getMechanics(true);
    const dashboardData = await getDashboardData(mechanics);
    const periods = getPeriodDates();

    return NextResponse.json({
      ...dashboardData,
      mechanics,
      periods,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

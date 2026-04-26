import { NextResponse } from "next/server";
import { getMechanics } from "@/lib/data/mechanics";
import { getDashboardData, getPeriodDates } from "@/lib/data/totals";
import { getBoardSettings } from "@/lib/data/board-settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [mechanics, boardSettings] = await Promise.all([
      getMechanics(true),
      getBoardSettings(),
    ]);

    const dashboardData = await getDashboardData(mechanics);
    const periods = getPeriodDates();

    return NextResponse.json({
      ...dashboardData,
      mechanics,
      periods,
      boardSettings,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

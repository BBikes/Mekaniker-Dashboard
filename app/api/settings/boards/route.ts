import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/server-auth";
import { getBoardSettings, upsertBoardSettings, type BoardSetting } from "@/lib/data/board-settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await getBoardSettings();
    return NextResponse.json(settings);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as BoardSetting[];
    if (!Array.isArray(body)) {
      return NextResponse.json({ error: "Expected array of board settings" }, { status: 400 });
    }
    await upsertBoardSettings(body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/server-auth";
import { getMechanics, upsertMechanic } from "@/lib/data/mechanics";
import type { Mechanic } from "@/lib/data/mechanics";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const mechanics = await getMechanics();
    return NextResponse.json(mechanics);
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
    const body = (await request.json()) as Partial<Mechanic>[];
    for (const mechanic of body) {
      await upsertMechanic(mechanic);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// This route is superseded by /api/sync/manual which now runs the full daily sync.
// Kept as a redirect for backwards compatibility.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    { message: "Use /api/sync/manual instead." },
    { status: 308, headers: { Location: "/api/sync/manual" } },
  );
}

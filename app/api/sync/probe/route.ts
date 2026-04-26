import { NextResponse } from "next/server";

// This probe endpoint is no longer used in the new sync architecture.
// Kept as a stub to avoid breaking imports.

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ message: "Probe endpoint deprecated. Use /api/sync/manual instead." }, { status: 410 });
}

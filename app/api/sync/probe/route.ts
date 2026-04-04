import { NextResponse } from "next/server";

import { probeCustomersFirstTicketMaterials } from "@/lib/sync/run-phase-one-sync";

export const runtime = "nodejs";

export async function GET() {
  try {
    const result = await probeCustomersFirstTicketMaterials();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown probe failure",
      },
      { status: 500 },
    );
  }
}

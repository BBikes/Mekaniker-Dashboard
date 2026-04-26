/**
 * BikeDesk sync engine
 *
 * Strategy: Daily snapshot at 16:00
 * - Fetch all tickets updated today (updated_at >= today 00:00)
 * - For each ticket, fetch all materials
 * - Filter materials by mechanic SKUs (client-side — API filter is unreliable)
 * - Sum amount per mechanic for today
 * - Track which ticket IDs each mechanic has time on
 * - UPSERT into daily_totals (overwrite today's row)
 *
 * This is correct because:
 * - Materials have no own date field; we use the sync date as "work date"
 * - Running at 16:00 captures the full working day
 * - UPSERT means re-running is idempotent
 */

import { getServerConfig } from "@/lib/env";

const PAGE_SIZE = 200;

export type Mechanic = {
  id: string;
  name: string;
  sku: string;
  display_order: number;
  active: boolean;
  daily_target_quarters: number;
};

export type SyncResult = {
  ticketsFetched: number;
  materialsProcessed: number;
  mechanicTotals: Record<string, number>;      // mechanic_id -> quarters today
  mechanicTicketIds: Record<string, number[]>; // mechanic_id -> ticket IDs with time today
  syncDate: string; // YYYY-MM-DD
  durationMs: number;
};

type RawTicket = {
  id: number;
  updated_at?: string | null;
};

type RawMaterial = {
  id: number;
  taskid: number;
  productno?: string | null;
  amount?: number | null;
};

async function fetchJson(url: string, token: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`BikeDesk API error ${res.status} for ${url}`);
  }

  return res.json();
}

function extractContent(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    if (Array.isArray(p.content)) return p.content;
    if (Array.isArray(p.data)) return p.data;
  }
  return [];
}

/**
 * Fetch all tickets updated on or after `updatedAfter` (YYYY-MM-DD HH:MM:SS).
 * Paginates through all pages.
 */
async function fetchUpdatedTickets(
  baseUrl: string,
  token: string,
  updatedAfter: string,
): Promise<number[]> {
  const ticketIds: number[] = [];
  let start = 0;
  let safety = 0;

  while (safety < 500) {
    safety++;
    const url =
      `${baseUrl}/tickets?type=repair` +
      `&updated_after=${encodeURIComponent(updatedAfter)}` +
      `&paginationStart=${start}` +
      `&paginationPageLength=${PAGE_SIZE}`;

    const payload = await fetchJson(url, token);
    const items = extractContent(payload) as RawTicket[];

    for (const item of items) {
      if (typeof item.id === "number") {
        ticketIds.push(item.id);
      }
    }

    const p = payload as Record<string, unknown>;
    const hasMore = p.hasMore === true || (Array.isArray(p.content) && p.content.length === PAGE_SIZE);
    if (!hasMore || items.length < PAGE_SIZE) break;

    start += PAGE_SIZE;
  }

  return ticketIds;
}

/**
 * Fetch all materials for a single ticket.
 */
async function fetchTicketMaterials(
  baseUrl: string,
  token: string,
  ticketId: number,
): Promise<RawMaterial[]> {
  const url = `${baseUrl}/tickets/materials?ticketid=${ticketId}&paginationPageLength=500`;
  const payload = await fetchJson(url, token);
  return extractContent(payload) as RawMaterial[];
}

/**
 * Main sync function.
 * syncDate: YYYY-MM-DD (the date we are syncing for, defaults to today)
 */
export async function runDailySync(
  mechanics: Mechanic[],
  syncDate?: string,
): Promise<SyncResult> {
  const start = Date.now();
  const config = getServerConfig();
  const baseUrl = config.bikeDeskApiBaseUrl.replace(/\/$/, "");
  const token = config.bikeDeskApiToken;

  // Build SKU → mechanic_id map
  const skuMap = new Map<string, string>();
  for (const m of mechanics) {
    if (m.active) {
      skuMap.set(m.sku.trim().toUpperCase(), m.id);
    }
  }

  // Determine sync date
  const today = syncDate ?? new Date().toISOString().slice(0, 10);
  const updatedAfter = `${today} 00:00:00`;

  // Fetch all tickets updated today
  const ticketIds = await fetchUpdatedTickets(baseUrl, token, updatedAfter);

  // For each ticket, fetch materials and sum mechanic quarters + track ticket IDs
  const mechanicTotals: Record<string, number> = {};
  const mechanicTicketIds: Record<string, Set<number>> = {};
  let materialsProcessed = 0;

  const BATCH_SIZE = 10;
  for (let i = 0; i < ticketIds.length; i += BATCH_SIZE) {
    const batch = ticketIds.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map((id) => fetchTicketMaterials(baseUrl, token, id)),
    );

    for (let j = 0; j < batchResults.length; j++) {
      const materials = batchResults[j];
      const ticketId = batch[j];

      for (const mat of materials) {
        materialsProcessed++;
        const pno = mat.productno?.trim().toUpperCase();
        if (!pno) continue;

        const mechanicId = skuMap.get(pno);
        if (!mechanicId) continue;

        const qty = typeof mat.amount === "number" ? mat.amount : 0;
        if (qty > 0) {
          mechanicTotals[mechanicId] = (mechanicTotals[mechanicId] ?? 0) + qty;

          // Track this ticket ID for the mechanic
          if (!mechanicTicketIds[mechanicId]) {
            mechanicTicketIds[mechanicId] = new Set();
          }
          mechanicTicketIds[mechanicId].add(ticketId);
        }
      }
    }
  }

  // Convert Sets to sorted arrays
  const mechanicTicketIdsArrays: Record<string, number[]> = {};
  for (const [mechanicId, ticketSet] of Object.entries(mechanicTicketIds)) {
    mechanicTicketIdsArrays[mechanicId] = Array.from(ticketSet).sort((a, b) => a - b);
  }

  return {
    ticketsFetched: ticketIds.length,
    materialsProcessed,
    mechanicTotals,
    mechanicTicketIds: mechanicTicketIdsArrays,
    syncDate: today,
    durationMs: Date.now() - start,
  };
}

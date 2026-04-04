import "server-only";

import { getServerConfig } from "@/lib/env";
import { extractItemsFromUnknownPayload, normalizeTicketMaterial, type NormalizedTicketMaterial } from "@/lib/c1st/normalize-ticket-material";

type PaginationOptions = {
  paginationStart?: number;
  paginationPageLength?: number;
};

type ListTicketsOptions = PaginationOptions & {
  updatedAfter?: string;
};

type ListTicketMaterialsOptions = PaginationOptions & {
  ticketId?: number;
};

export type NormalizedTicket = {
  ticketId: number;
  updatedAt: string | null;
  createdAt: string | null;
  raw: Record<string, unknown>;
};

type PaginatedResult<T> = {
  raw: unknown;
  rawItems: Record<string, unknown>[];
  normalizedItems: T[];
  nextStart: number | null;
  totalCount: number | null;
};

export type TicketsPage = PaginatedResult<NormalizedTicket>;
export type TicketMaterialsPage = PaginatedResult<NormalizedTicketMaterial>;

function parseExtraQuery(rawValue: string): URLSearchParams {
  const params = new URLSearchParams();
  if (!rawValue) {
    return params;
  }

  const parsed = new URLSearchParams(rawValue);
  for (const [key, value] of parsed.entries()) {
    params.append(key, value);
  }

  return params;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function inferTotalCount(payload: unknown): number | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  for (const candidate of [record.total, record.count, record.totalCount]) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  return null;
}

function inferNextStart(payload: unknown, currentStart: number, pageLength: number, receivedCount: number): number | null {
  if (receivedCount === 0) {
    return null;
  }

  const record = asRecord(payload);
  if (!record) {
    return receivedCount < pageLength ? null : currentStart + receivedCount;
  }

  const nestedPagination = asRecord(record.pagination);
  const nextStart = record.paginationNextStart ?? record.nextStart ?? nestedPagination?.nextStart;
  if (typeof nextStart === "number") {
    return Number.isFinite(nextStart) ? nextStart : null;
  }

  const totalCount = inferTotalCount(payload);
  if (totalCount !== null) {
    return currentStart + receivedCount >= totalCount ? null : currentStart + receivedCount;
  }

  return receivedCount < pageLength ? null : currentStart + receivedCount;
}

function toInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toStringValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return null;
}

function normalizeTicket(raw: Record<string, unknown>): NormalizedTicket | null {
  const ticketId = toInteger(raw.id ?? raw.ticketid ?? raw.taskid);
  if (ticketId === null) {
    return null;
  }

  return {
    ticketId,
    updatedAt: toStringValue(raw.updated_at ?? raw.updatedAt),
    createdAt: toStringValue(raw.created ?? raw.created_at ?? raw.createdAt),
    raw,
  };
}

export class CustomersFirstClient {
  private readonly config = getServerConfig();

  private async requestPage<T>({
    path,
    params,
    normalize,
    paginationStart,
    paginationPageLength,
  }: {
    path: string;
    params?: URLSearchParams;
    normalize: (raw: Record<string, unknown>) => T | null;
    paginationStart: number;
    paginationPageLength: number;
  }): Promise<PaginatedResult<T>> {
    const baseUrl = this.config.c1stApiBaseUrl.replace(/\/$/, "");
    const url = new URL(`${baseUrl}${path}`);
    const searchParams = params ?? new URLSearchParams();
    searchParams.set("paginationStart", String(paginationStart));
    searchParams.set("paginationPageLength", String(paginationPageLength));
    url.search = searchParams.toString();

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.config.c1stApiToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Customers 1st request failed with ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as unknown;
    const rawItems = extractItemsFromUnknownPayload(payload);
    const normalizedItems = rawItems
      .map((item) => normalize(item))
      .filter((item): item is T => item !== null);

    return {
      raw: payload,
      rawItems,
      normalizedItems,
      nextStart: inferNextStart(payload, paginationStart, paginationPageLength, rawItems.length),
      totalCount: inferTotalCount(payload),
    };
  }

  async listTicketsPage(options: ListTicketsOptions = {}): Promise<TicketsPage> {
    const pageLength = options.paginationPageLength ?? this.config.c1stDefaultPageLength;
    const paginationStart = options.paginationStart ?? 0;
    const params = new URLSearchParams();

    if (options.updatedAfter) {
      params.set("updated_after", options.updatedAfter);
    }

    return this.requestPage({
      path: "/tickets",
      params,
      normalize: normalizeTicket,
      paginationStart,
      paginationPageLength: pageLength,
    });
  }

  async listAllUpdatedTickets(updatedAfter: string) {
    const pages: TicketsPage[] = [];
    const seenTicketIds = new Set<number>();
    let paginationStart = 0;
    let safetyCounter = 0;

    while (safetyCounter < 1000) {
      safetyCounter += 1;
      const page = await this.listTicketsPage({ updatedAfter, paginationStart });
      pages.push(page);

      if (page.nextStart === null) {
        break;
      }

      paginationStart = page.nextStart;
    }

    if (safetyCounter >= 1000) {
      throw new Error("Stopped Customers 1st ticket pagination after 1000 pages");
    }

    const normalizedItems = pages
      .flatMap((page) => page.normalizedItems)
      .filter((ticket) => {
        if (seenTicketIds.has(ticket.ticketId)) {
          return false;
        }

        seenTicketIds.add(ticket.ticketId);
        return true;
      });

    return {
      pages,
      rawItems: pages.flatMap((page) => page.rawItems),
      normalizedItems,
      httpCalls: pages.length,
    };
  }

  async listTicketMaterialsPage(options: ListTicketMaterialsOptions = {}): Promise<TicketMaterialsPage> {
    const pageLength = options.paginationPageLength ?? this.config.c1stDefaultPageLength;
    const paginationStart = options.paginationStart ?? 0;
    const params = parseExtraQuery(this.config.c1stExtraTicketMaterialQuery);

    if (typeof options.ticketId === "number") {
      params.set("ticketid", String(options.ticketId));
    }

    return this.requestPage({
      path: "/tickets/materials",
      params,
      normalize: normalizeTicketMaterial,
      paginationStart,
      paginationPageLength: pageLength,
    });
  }

  async listAllTicketMaterialsForTicket(ticketId: number) {
    const pages: TicketMaterialsPage[] = [];
    let paginationStart = 0;
    let safetyCounter = 0;

    while (safetyCounter < 1000) {
      safetyCounter += 1;
      const page = await this.listTicketMaterialsPage({ ticketId, paginationStart });
      pages.push(page);

      if (page.nextStart === null) {
        break;
      }

      paginationStart = page.nextStart;
    }

    if (safetyCounter >= 1000) {
      throw new Error(`Stopped Customers 1st material pagination after 1000 pages for ticket ${ticketId}`);
    }

    return {
      pages,
      rawItems: pages.flatMap((page) => page.rawItems),
      normalizedItems: pages.flatMap((page) => page.normalizedItems),
      httpCalls: pages.length,
    };
  }
}

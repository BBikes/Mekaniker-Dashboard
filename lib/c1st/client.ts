import "server-only";

import { getServerConfig } from "@/lib/env";
import { extractItemsFromUnknownPayload, normalizeTicketMaterial, type NormalizedTicketMaterial } from "@/lib/c1st/normalize-ticket-material";
import { extractItemsFromPaymentPayload, normalizePayment, type NormalizedPayment } from "@/lib/c1st/normalize-payment";

type PaginationOptions = {
  paginationStart?: number;
  paginationPageLength?: number;
};

type ListTicketsOptions = PaginationOptions & {
  updatedAfter?: string;
};

type ListTicketMaterialsOptions = PaginationOptions & {
  ticketId?: number;
  updatedAfter?: string;
};

export type NormalizedTicket = {
  ticketId: number;
  ticketType: string | null;
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
const MAX_RETRY_ATTEMPTS = 3;

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
    ticketType: toStringValue(raw.type ?? raw.tickettype ?? raw.tasktype),
    updatedAt: toStringValue(raw.updated_at ?? raw.updatedAt),
    createdAt: toStringValue(raw.created ?? raw.created_at ?? raw.createdAt),
    raw,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readRetryDelayMs(response: Response, attempt: number) {
  const retryAfterHeader = response.headers.get("retry-after");
  if (retryAfterHeader) {
    const seconds = Number.parseInt(retryAfterHeader, 10);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }
  }

  return attempt * 1000;
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

    let response: Response | null = null;
    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt += 1) {
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.config.c1stApiToken}`,
          Accept: "application/json",
        },
        cache: "no-store",
      });

      if (response.ok) {
        break;
      }

      if (response.status !== 429 || attempt === MAX_RETRY_ATTEMPTS) {
        throw new Error(`Customers 1st request failed with ${response.status} ${response.statusText}`);
      }

      await sleep(readRetryDelayMs(response, attempt));
    }

    if (!response || !response.ok) {
      throw new Error("Customers 1st request failed without a valid response.");
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

    if (options.updatedAfter && this.config.c1stUseUpdatedAfter) {
      params.set(this.config.c1stUpdatedAfterParam, options.updatedAfter);
    }

    return this.requestPage({
      path: "/tickets/materials",
      params,
      normalize: normalizeTicketMaterial,
      paginationStart,
      paginationPageLength: pageLength,
    });
  }

  async listAllUpdatedPayments(updatedAfter: string): Promise<{ normalizedItems: NormalizedPayment[]; httpCalls: number }> {
    const baseUrl = this.config.c1stApiBaseUrl.replace(/\/$/, "");
    const pageLength = this.config.c1stDefaultPageLength;
    const allItems: NormalizedPayment[] = [];
    let paginationStart = 0;
    let httpCalls = 0;
    let safetyCounter = 0;

    while (safetyCounter < 1000) {
      safetyCounter += 1;

      const params = new URLSearchParams();
      params.set("updated_after", updatedAfter);
      params.set("extra", "1"); // includes articles and taskids
      params.set("paginationStart", String(paginationStart));
      params.set("paginationPageLength", String(pageLength));

      const url = new URL(`${baseUrl}/pospayments`);
      url.search = params.toString();

      let response: Response | null = null;
      for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt += 1) {
        response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${this.config.c1stApiToken}`,
            Accept: "application/json",
          },
          cache: "no-store",
        });

        if (response.ok) {
          break;
        }

        if (response.status !== 429 || attempt === MAX_RETRY_ATTEMPTS) {
          throw new Error(`Customers 1st /pospayments request failed with ${response.status} ${response.statusText}`);
        }

        await sleep(readRetryDelayMs(response, attempt));
      }

      if (!response || !response.ok) {
        throw new Error("Customers 1st /pospayments request failed without a valid response.");
      }

      httpCalls += 1;
      const payload = (await response.json()) as unknown;
      const rawItems = extractItemsFromPaymentPayload(payload);
      const normalizedItems = rawItems.flatMap((item) => {
        const n = normalizePayment(item);
        return n ? [n] : [];
      });

      allItems.push(...normalizedItems);

      const nextStart = inferNextStart(payload, paginationStart, pageLength, rawItems.length);
      if (nextStart === null) {
        break;
      }

      paginationStart = nextStart;
    }

    return { normalizedItems: allItems, httpCalls };
  }

  async listAllUpdatedTicketMaterials(updatedAfter: string): Promise<{ normalizedItems: NormalizedTicketMaterial[]; httpCalls: number }> {
    if (!this.config.c1stUseUpdatedAfter) {
      return { normalizedItems: [], httpCalls: 0 };
    }

    const pages: TicketMaterialsPage[] = [];
    const seenMaterialIds = new Set<number>();
    let paginationStart = 0;
    let safetyCounter = 0;

    while (safetyCounter < 1000) {
      safetyCounter += 1;
      const page = await this.listTicketMaterialsPage({ updatedAfter, paginationStart });
      pages.push(page);

      if (page.nextStart === null) {
        break;
      }

      paginationStart = page.nextStart;
    }

    if (safetyCounter >= 1000) {
      throw new Error("Stopped Customers 1st material pagination after 1000 pages");
    }

    const normalizedItems = pages
      .flatMap((page) => page.normalizedItems)
      .filter((material) => {
        if (seenMaterialIds.has(material.ticketMaterialId)) {
          return false;
        }

        seenMaterialIds.add(material.ticketMaterialId);
        return true;
      });

    return {
      normalizedItems,
      httpCalls: pages.length,
    };
  }

  async getCykelPlusCustomerCount(tag: string): Promise<number> {
    const params = new URLSearchParams();
    params.set("tags", tag);
    params.set("paginationStart", "0");
    params.set("paginationPageLength", "1");

    const baseUrl = this.config.c1stApiBaseUrl.replace(/\/$/, "");
    const url = new URL(`${baseUrl}/customers`);
    url.search = params.toString();

    let response: Response | null = null;
    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt += 1) {
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.config.c1stApiToken}`,
          Accept: "application/json",
        },
        cache: "no-store",
      });

      if (response.ok) {
        break;
      }

      if (response.status !== 429 || attempt === MAX_RETRY_ATTEMPTS) {
        throw new Error(`Customers 1st /customers request failed with ${response.status} ${response.statusText}`);
      }

      await sleep(readRetryDelayMs(response, attempt));
    }

    if (!response || !response.ok) {
      throw new Error("Customers 1st /customers request failed without a valid response.");
    }

    const payload = (await response.json()) as unknown;
    const total = inferTotalCount(payload);
    if (total !== null) {
      return total;
    }

    // Fallback: count items in payload
    const items = extractItemsFromUnknownPayload(payload);
    return items.length;
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

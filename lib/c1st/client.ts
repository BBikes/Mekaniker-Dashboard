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
  productNo?: string;
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

function extractSingleContentRecord(payload: unknown): Record<string, unknown> | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  return asRecord(record.content) ?? record;
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

function normalizeSearchToken(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
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

  private async requestJson({
    path,
    params,
    returnNullOn404 = false,
  }: {
    path: string;
    params?: URLSearchParams;
    returnNullOn404?: boolean;
  }): Promise<unknown | null> {
    const baseUrl = this.config.c1stApiBaseUrl.replace(/\/$/, "");
    const url = new URL(`${baseUrl}${path}`);
    if (params) {
      url.search = params.toString();
    }

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

      if (returnNullOn404 && response.status === 404) {
        return null;
      }

      if (response.status !== 429 || attempt === MAX_RETRY_ATTEMPTS) {
        throw new Error(`Customers 1st request failed with ${response.status} ${response.statusText}`);
      }

      await sleep(readRetryDelayMs(response, attempt));
    }

    if (!response || !response.ok) {
      throw new Error("Customers 1st request failed without a valid response.");
    }

    return (await response.json()) as unknown;
  }

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
    const searchParams = params ?? new URLSearchParams();
    searchParams.set("paginationStart", String(paginationStart));
    searchParams.set("paginationPageLength", String(paginationPageLength));
    const payload = await this.requestJson({ path, params: searchParams });
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

    if (options.productNo) {
      params.set(this.config.c1stTicketMaterialProductNoParam, options.productNo);
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

  async listAllUpdatedTicketMaterialsForProductNos(
    updatedAfter: string,
    productNos: string[],
  ): Promise<{ normalizedItems: NormalizedTicketMaterial[]; httpCalls: number }> {
    if (!this.config.c1stUseUpdatedAfter) {
      throw new Error("Filtered Customers 1st material sync requires C1ST_USE_UPDATED_AFTER=true.");
    }

    const normalizedProductNos = [...new Set(productNos.map((value) => value.trim()).filter(Boolean))];
    const seenMaterialIds = new Set<number>();
    const normalizedItems: NormalizedTicketMaterial[] = [];
    let httpCalls = 0;

    for (const productNo of normalizedProductNos) {
      let paginationStart = 0;
      let safetyCounter = 0;

      while (safetyCounter < 1000) {
        safetyCounter += 1;
        const page = await this.listTicketMaterialsPage({ updatedAfter, productNo, paginationStart });
        httpCalls += 1;

        const nonMatchingMaterial = page.normalizedItems.find((material) => material.productNo?.trim() !== productNo);
        if (nonMatchingMaterial) {
          throw new Error(
            `Customers 1st material endpoint did not honor ${this.config.c1stTicketMaterialProductNoParam} filter for ${productNo}.`,
          );
        }

        for (const material of page.normalizedItems) {
          if (seenMaterialIds.has(material.ticketMaterialId)) {
            continue;
          }

          seenMaterialIds.add(material.ticketMaterialId);
          normalizedItems.push(material);
        }

        if (page.nextStart === null) {
          break;
        }

        paginationStart = page.nextStart;
      }

      if (safetyCounter >= 1000) {
        throw new Error(`Stopped Customers 1st material pagination after 1000 pages for product ${productNo}`);
      }
    }

    return { normalizedItems, httpCalls };
  }

  async getCykelPlusCustomerCount(tag: string): Promise<number> {
    const tagId = await this.getCustomerTagId(tag);
    if (tagId === null) {
      return 0;
    }

    let paginationStart = 0;
    let total = 0;
    let safetyCounter = 0;

    while (safetyCounter < 1000) {
      safetyCounter += 1;

      const params = new URLSearchParams();
      params.set("tags", String(tagId));
      params.set("paginationStart", String(paginationStart));
      params.set("paginationPageLength", String(this.config.c1stDefaultPageLength));

      const payload = await this.requestJson({ path: "/customers", params });
      const items = extractItemsFromUnknownPayload(payload);

      total += items.filter((item) => {
        const customer = asRecord(item);
        if (!customer || !Array.isArray(customer.tags)) {
          return false;
        }

        return customer.tags.some((rawTag) => {
          const customerTag = asRecord(rawTag);
          const customerTagId = toInteger(customerTag?.id);
          return customerTagId === tagId;
        });
      }).length;

      const nextStart = inferNextStart(payload, paginationStart, this.config.c1stDefaultPageLength, items.length);
      if (nextStart === null) {
        break;
      }

      paginationStart = nextStart;
    }

    if (safetyCounter >= 1000) {
      throw new Error("Stopped Customers 1st customer pagination after 1000 pages");
    }

    return total;
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

  async getTicketById(ticketId: number): Promise<NormalizedTicket | null> {
    const payload = await this.requestJson({
      path: `/tickets/${ticketId}`,
      returnNullOn404: true,
    });

    if (payload === null) {
      return null;
    }

    const record = extractSingleContentRecord(payload);
    if (!record) {
      return null;
    }

    return normalizeTicket(record);
  }

  private async getCustomerTagId(tag: string): Promise<number | null> {
    const explicitTagId = toInteger(tag);
    if (explicitTagId !== null) {
      return explicitTagId;
    }

    const params = new URLSearchParams();
    params.set("freetext", tag);
    params.set("paginationStart", "0");
    params.set("paginationPageLength", String(this.config.c1stDefaultPageLength));

    const payload = await this.requestJson({ path: "/customertags", params });
    const searchToken = normalizeSearchToken(tag);
    const matchingTag = extractItemsFromUnknownPayload(payload)
      .map((item) => {
        const customerTag = asRecord(item);
        if (!customerTag) {
          return null;
        }

        return {
          id: toInteger(customerTag.id),
          title: toStringValue(customerTag.title),
          handle: toStringValue(customerTag.handle),
        };
      })
      .find((customerTag) => {
        if (!customerTag?.id) {
          return false;
        }

        return [customerTag.title, customerTag.handle]
          .filter((value): value is string => Boolean(value))
          .some((value) => normalizeSearchToken(value) === searchToken);
      });

    return matchingTag?.id ?? null;
  }
}

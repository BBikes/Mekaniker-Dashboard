import "server-only";

import { getServerConfig } from "@/lib/env";
import { extractItemsFromUnknownPayload, normalizeTicketMaterial, type NormalizedTicketMaterial } from "@/lib/c1st/normalize-ticket-material";

type ListTicketMaterialsOptions = {
  paginationStart?: number;
  paginationPageLength?: number;
  updatedAfter?: string;
};

export type TicketMaterialsPage = {
  raw: unknown;
  rawItems: Record<string, unknown>[];
  normalizedItems: NormalizedTicketMaterial[];
  nextStart: number | null;
};

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

function inferNextStart(payload: unknown, currentStart: number, pageLength: number, receivedCount: number): number | null {
  if (receivedCount === 0) {
    return null;
  }

  const record = payload !== null && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;

  if (!record) {
    return receivedCount < pageLength ? null : currentStart + receivedCount;
  }

  const nestedPagination = record.pagination !== null && typeof record.pagination === "object"
    ? (record.pagination as Record<string, unknown>)
    : null;

  const nextStart = record.paginationNextStart ?? record.nextStart ?? nestedPagination?.nextStart;
  if (typeof nextStart === "number") {
    return Number.isFinite(nextStart) ? nextStart : null;
  }

  const totalCount = typeof record.total === "number"
    ? record.total
    : typeof record.count === "number"
      ? record.count
      : typeof record.totalCount === "number"
        ? record.totalCount
        : null;

  if (totalCount !== null) {
    return currentStart + receivedCount >= totalCount ? null : currentStart + receivedCount;
  }

  return receivedCount < pageLength ? null : currentStart + receivedCount;
}

export class CustomersFirstClient {
  private readonly config = getServerConfig();

  async listTicketMaterialsPage(options: ListTicketMaterialsOptions = {}): Promise<TicketMaterialsPage> {
    const pageLength = options.paginationPageLength ?? this.config.c1stDefaultPageLength;
    const paginationStart = options.paginationStart ?? 0;
    const params = parseExtraQuery(this.config.c1stExtraTicketMaterialQuery);

    params.set("paginationStart", String(paginationStart));
    params.set("paginationPageLength", String(pageLength));

    if (this.config.c1stUseUpdatedAfter && options.updatedAfter) {
      params.set(this.config.c1stUpdatedAfterParam, options.updatedAfter);
    }

    const baseUrl = this.config.c1stApiBaseUrl.replace(/\/$/, "");
    const url = new URL(`${baseUrl}/tickets/materials`);
    url.search = params.toString();

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
      .map((item) => normalizeTicketMaterial(item))
      .filter((item): item is NormalizedTicketMaterial => item !== null);

    return {
      raw: payload,
      rawItems,
      normalizedItems,
      nextStart: inferNextStart(payload, paginationStart, pageLength, rawItems.length),
    };
  }

  async listAllTicketMaterials(options: Omit<ListTicketMaterialsOptions, "paginationStart"> = {}) {
    const pages: TicketMaterialsPage[] = [];
    let paginationStart = 0;
    let safetyCounter = 0;

    while (safetyCounter < 1000) {
      safetyCounter += 1;
      const page = await this.listTicketMaterialsPage({ ...options, paginationStart });
      pages.push(page);

      if (page.nextStart === null) {
        break;
      }

      paginationStart = page.nextStart;
    }

    if (safetyCounter >= 1000) {
      throw new Error("Stopped Customers 1st pagination after 1000 pages");
    }

    return {
      pages,
      rawItems: pages.flatMap((page) => page.rawItems),
      normalizedItems: pages.flatMap((page) => page.normalizedItems),
      httpCalls: pages.length,
    };
  }
}

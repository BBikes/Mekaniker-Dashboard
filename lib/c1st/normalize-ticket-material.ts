export type NormalizedTicketMaterial = {
  ticketMaterialId: number;
  ticketId: number;
  productNo: string | null;
  title: string | null;
  amount: number;
  sourceDate: string | null;
  updatedAt: string | null;
  paymentId: number | null;
  amountPaid: number | null;
  raw: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readPath(record: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = record;

  for (const segment of path) {
    const currentRecord = asRecord(current);
    if (!currentRecord) {
      return undefined;
    }

    current = currentRecord[segment];
  }

  return current;
}

function firstValue(record: Record<string, unknown>, paths: string[][]): unknown {
  for (const path of paths) {
    const value = readPath(record, path);
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return undefined;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.replace(",", ".").trim();
    if (!normalized) {
      return null;
    }

    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toInteger(value: unknown): number | null {
  const parsed = toNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function toStringValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function toDateString(value: unknown): string | null {
  const stringValue = toStringValue(value);
  if (!stringValue) {
    return null;
  }

  const match = /^(\d{4}-\d{2}-\d{2})/.exec(stringValue);
  return match ? match[1] : null;
}

export function normalizeTicketMaterial(raw: unknown): NormalizedTicketMaterial | null {
  const record = asRecord(raw);
  if (!record) {
    return null;
  }

  const ticketMaterialId = toInteger(
    firstValue(record, [["id"], ["ticketmaterialid"], ["taskmaterialid"]]),
  );
  const ticketId = toInteger(firstValue(record, [["taskid"], ["ticketid"], ["ticket", "id"], ["task", "id"]]));
  const amount = toNumber(firstValue(record, [["amount"], ["quantity"], ["qty"]]));

  if (ticketMaterialId === null || ticketId === null || amount === null) {
    return null;
  }

  return {
    ticketMaterialId,
    ticketId,
    productNo: toStringValue(
      firstValue(record, [
        ["productno"],
        ["product_no"],
        ["itemno"],
        ["article_no"],
        ["product", "productno"],
        ["product", "product_no"],
        ["article", "productno"],
        ["customerarticle", "productno"],
        ["customerArticle", "productno"],
      ]),
    ),
    title: toStringValue(firstValue(record, [["title"], ["product", "title"], ["product", "name"]])),
    sourceDate: toDateString(
      firstValue(record, [["date"], ["created_at"], ["createdAt"], ["task", "date"], ["ticket", "date"]]),
    ),
    updatedAt: toStringValue(
      firstValue(record, [["updated_at"], ["updatedAt"], ["lastupdated"], ["last_updated"]]),
    ),
    paymentId: toInteger(firstValue(record, [["paymentid"], ["payment_id"], ["payment", "id"]])),
    amountPaid: toNumber(firstValue(record, [["amountpaid"], ["amount_paid"]])),
    amount,
    raw: record,
  };
}

export function extractItemsFromUnknownPayload(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter((entry): entry is Record<string, unknown> => entry !== null && typeof entry === "object");
  }

  const record = asRecord(payload);
  if (!record) {
    return [];
  }

  const candidate = firstValue(record, [["content"], ["data"], ["items"], ["results"]]);
  if (Array.isArray(candidate)) {
    return candidate.filter((entry): entry is Record<string, unknown> => entry !== null && typeof entry === "object");
  }

  return [];
}

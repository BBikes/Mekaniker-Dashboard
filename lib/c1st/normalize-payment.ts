export type NormalizedPaymentArticle = {
  productNo: string | null;
  quantity: number;
  totalInclVat: number;
};

export type NormalizedPayment = {
  paymentId: number;
  paymentDate: string | null; // ISO YYYY-MM-DD
  totalSum: number;
  articles: NormalizedPaymentArticle[];
  taskIds: number[];
  raw: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.replace(",", ".").trim();
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function toInteger(value: unknown): number | null {
  const n = toNumber(value);
  if (n === 0 && value !== 0 && value !== "0") {
    return null;
  }

  return Math.trunc(n);
}

function toStringValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return null;
}

function toDateString(value: unknown): string | null {
  const s = toStringValue(value);
  if (!s) return null;

  const match = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return match ? match[1] : null;
}

function normalizeArticle(raw: unknown): NormalizedPaymentArticle | null {
  const record = asRecord(raw);
  if (!record) return null;

  // productno is deprecated on PaymentArticle; try nested product.productno first
  const product = asRecord(record.product);
  const productNo =
    toStringValue(product?.productno ?? product?.product_no ?? record.productno ?? record.product_no ?? null);

  const totalInclVat = toNumber(record.total_incl_vat ?? record.totalinclvat);
  const quantity = toNumber(record.quantity ?? record.amount ?? record.qty ?? 1);

  return { productNo, quantity, totalInclVat };
}

export function normalizePayment(raw: unknown): NormalizedPayment | null {
  const record = asRecord(raw);
  if (!record) return null;

  const paymentId = toInteger(record.id ?? record.paymentid);
  if (paymentId === null) return null;

  const articles = Array.isArray(record.articles)
    ? (record.articles as unknown[]).flatMap((a) => {
        const n = normalizeArticle(a);
        return n ? [n] : [];
      })
    : [];

  const taskIds = Array.isArray(record.taskids)
    ? (record.taskids as unknown[]).flatMap((id) => {
        const n = toInteger(id);
        return n !== null ? [n] : [];
      })
    : [];

  return {
    paymentId,
    paymentDate: toDateString(record.date ?? record.payment_date),
    totalSum: toNumber(record.sum),
    articles,
    taskIds,
    raw: record,
  };
}

export function extractItemsFromPaymentPayload(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter((e): e is Record<string, unknown> => e !== null && typeof e === "object");
  }

  const record = asRecord(payload);
  if (!record) return [];

  const candidate =
    record.content ?? record.data ?? record.items ?? record.results ?? record.payments;
  if (Array.isArray(candidate)) {
    return candidate.filter((e): e is Record<string, unknown> => e !== null && typeof e === "object");
  }

  return [];
}

import "server-only";

import { cache } from "react";

import { createAdminClient } from "@/lib/supabase/server";
import { formatPercent, getMonthKey, getWeekKey } from "@/lib/time";

export type PeriodMode = "daily" | "weekly_avg" | "monthly_avg";
export type ExportMode = "summary" | "detailed";
export type SortDirection = "asc" | "desc";
export type AdminStatus = "all" | "paid" | "open" | "anomaly";

export type ReportFilters = {
  fromDate: string;
  toDate: string;
  periodMode: PeriodMode;
  exportMode: ExportMode;
  mechanicId?: string;
};

export type AdminFilters = {
  fromDate: string;
  toDate: string;
  periodMode: PeriodMode;
  mechanicId?: string;
  mechanicIds?: string[];
  q?: string;
  sort?: string;
  dir?: SortDirection;
};

export type AdminDetailedFilters = AdminFilters & {
  status?: AdminStatus;
  page?: number;
  pageSize?: number;
};

export type ActiveMechanic = {
  id: string;
  mechanicName: string;
};

export type SummaryRow = {
  period: string;
  mechanicName: string;
  quarters: number;
  hours: number;
  targetHours: number;
  varianceHours: number;
};

export type DetailedRow = {
  mechanicId: string;
  statDate: string;
  mechanicName: string;
  ticketId: number;
  ticketMaterialId: number;
  mechanicItemNo: string;
  baselineQuantity: number;
  currentQuantity: number;
  todayAddedQuantity: number;
  hours: number;
  paymentId: number | null;
  amountPaid: number | null;
  sourceUpdatedAt: string | null;
  anomalyCode: string | null;
};

export type DetailedPage = {
  rows: DetailedRow[];
  total: number;
};

export type AdminSummaryRow = {
  mechanicId: string;
  mechanicName: string;
  quarters: number;
  hours: number;
  targetHours: number;
  varianceHours: number;
  fulfillmentPct: number;
  workdays: number;
  tickets: number;
  avgHoursPerDay: number;
  avgHoursPerTicket: number;
};

export type KpiSnapshot = {
  totalHours: number;
  totalQuarters: number;
  totalTarget: number;
  fulfillmentPct: number;
  mechanicsCount: number;
  workdaysCount: number;
  ticketsCount: number;
  avgPerMechanic: number;
  avgPerDay: number;
};

type TotalsSourceRow = {
  statDate: string;
  mechanicId: string;
  mechanicName: string;
  quartersTotal: number;
  hoursTotal: number;
  targetHours: number;
  varianceHours: number;
};

type TicketActivityRow = {
  statDate: string;
  mechanicId: string;
  ticketId: number;
};

type SummaryDataset = {
  rows: AdminSummaryRow[];
  kpis: KpiSnapshot;
};

const CSV_DELIMITER = ";";
const CSV_BOM = "\uFEFF";
const SUMMARY_DEFAULT_SORT = "hours";
const DETAILED_DEFAULT_SORT = "date";
const collator = new Intl.Collator("da-DK", {
  numeric: true,
  sensitivity: "base",
});

function roundNumber(value: number): number {
  return Math.round(value * 100) / 100;
}

function toNumeric(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeQuery(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeMechanicIds(filters: Pick<AdminFilters, "mechanicId" | "mechanicIds">): string[] {
  const ids = [...(filters.mechanicIds ?? [])];

  if (filters.mechanicId) {
    ids.push(filters.mechanicId);
  }

  return [...new Set(ids.filter((value) => value.length > 0))];
}

function applyDirection(result: number, direction: SortDirection): number {
  return direction === "asc" ? result : -result;
}

function compareText(left: string, right: string): number {
  return collator.compare(left, right);
}

function compareNumber(left: number, right: number): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function sanitizeOrValue(value: string): string {
  return value.replaceAll(",", " ").replaceAll("(", " ").replaceAll(")", " ").trim();
}

function parseTicketQuery(value?: string): number | null {
  if (!value || !/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function normalizePage(value?: number): number {
  if (!value || value < 1 || !Number.isFinite(value)) {
    return 1;
  }

  return Math.floor(value);
}

function normalizePageSize(value?: number): number {
  if (value === 25 || value === 50 || value === 100 || value === 200) {
    return value;
  }

  return 50;
}

function normalizeDirection(direction: string | undefined, fallback: SortDirection): SortDirection {
  return direction === "asc" || direction === "desc" ? direction : fallback;
}

function isSummaryMechanicMatch(mechanicName: string, query?: string) {
  if (!query) {
    return true;
  }

  return mechanicName.toLocaleLowerCase("da-DK").includes(query.toLocaleLowerCase("da-DK"));
}

function serializeSummaryDatasetFilters(filters: AdminFilters): string {
  return JSON.stringify({
    fromDate: filters.fromDate,
    toDate: filters.toDate,
    mechanicIds: normalizeMechanicIds(filters),
    q: normalizeQuery(filters.q) ?? null,
  });
}

async function fetchTotalsSourceRows(filters: Pick<AdminFilters, "fromDate" | "toDate" | "mechanicId" | "mechanicIds">) {
  const supabase = createAdminClient();
  const mechanicIds = normalizeMechanicIds(filters);
  let query = supabase
    .from("daily_mechanic_totals")
    .select(
      "stat_date, mechanic_id, quarters_total, hours_total, target_hours, variance_hours, mechanic:mechanic_item_mapping(mechanic_name)",
    )
    .gte("stat_date", filters.fromDate)
    .lte("stat_date", filters.toDate)
    .order("stat_date", { ascending: true });

  if (mechanicIds.length === 1) {
    query = query.eq("mechanic_id", mechanicIds[0]);
  } else if (mechanicIds.length > 1) {
    query = query.in("mechanic_id", mechanicIds);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to load summary rows: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    statDate: row.stat_date as string,
    mechanicId: row.mechanic_id as string,
    mechanicName: ((row.mechanic as { mechanic_name?: string } | null)?.mechanic_name ?? "Unknown mechanic") as string,
    quartersTotal: toNumeric(row.quarters_total),
    hoursTotal: toNumeric(row.hours_total),
    targetHours: toNumeric(row.target_hours),
    varianceHours: toNumeric(row.variance_hours),
  })) satisfies TotalsSourceRow[];
}

async function fetchTicketActivityRows(filters: Pick<AdminDetailedFilters, "fromDate" | "toDate" | "mechanicId" | "mechanicIds">) {
  const supabase = createAdminClient();
  const mechanicIds = normalizeMechanicIds(filters);
  let query = supabase
    .from("daily_ticket_item_baselines")
    .select("stat_date, mechanic_id, ticket_id")
    .gte("stat_date", filters.fromDate)
    .lte("stat_date", filters.toDate);

  if (mechanicIds.length === 1) {
    query = query.eq("mechanic_id", mechanicIds[0]);
  } else if (mechanicIds.length > 1) {
    query = query.in("mechanic_id", mechanicIds);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to load ticket activity: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    statDate: row.stat_date as string,
    mechanicId: row.mechanic_id as string,
    ticketId: toNumeric(row.ticket_id),
  })) satisfies TicketActivityRow[];
}

const loadSummaryDataset = cache(async (serializedFilters: string): Promise<SummaryDataset> => {
  const parsed = JSON.parse(serializedFilters) as {
    fromDate: string;
    toDate: string;
    mechanicIds: string[];
    q: string | null;
  };
  const baseFilters = {
    fromDate: parsed.fromDate,
    toDate: parsed.toDate,
    mechanicIds: parsed.mechanicIds,
  };
  const [totalsRows, ticketRows] = await Promise.all([fetchTotalsSourceRows(baseFilters), fetchTicketActivityRows(baseFilters)]);
  const query = normalizeQuery(parsed.q);
  const filteredTotals = totalsRows.filter((row) => isSummaryMechanicMatch(row.mechanicName, query));
  const aggregates = new Map<
    string,
    {
      mechanicId: string;
      mechanicName: string;
      quarters: number;
      hours: number;
      targetHours: number;
      varianceHours: number;
      workdays: Set<string>;
    }
  >();

  for (const row of filteredTotals) {
    const current = aggregates.get(row.mechanicId) ?? {
      mechanicId: row.mechanicId,
      mechanicName: row.mechanicName,
      quarters: 0,
      hours: 0,
      targetHours: 0,
      varianceHours: 0,
      workdays: new Set<string>(),
    };

    current.quarters += row.quartersTotal;
    current.hours += row.hoursTotal;
    current.targetHours += row.targetHours;
    current.varianceHours += row.varianceHours;
    current.workdays.add(row.statDate);
    aggregates.set(row.mechanicId, current);
  }

  const visibleMechanicIds = new Set(aggregates.keys());
  const ticketIdsByMechanic = new Map<string, Set<number>>();
  const uniqueTicketIds = new Set<number>();

  for (const row of ticketRows) {
    if (!visibleMechanicIds.has(row.mechanicId)) {
      continue;
    }

    const current = ticketIdsByMechanic.get(row.mechanicId) ?? new Set<number>();
    current.add(row.ticketId);
    ticketIdsByMechanic.set(row.mechanicId, current);
    uniqueTicketIds.add(row.ticketId);
  }

  const rows = [...aggregates.values()].map((entry) => {
    const tickets = ticketIdsByMechanic.get(entry.mechanicId)?.size ?? 0;
    const workdays = entry.workdays.size;
    const fulfillmentPct = entry.targetHours > 0 ? entry.hours / entry.targetHours : 0;

    return {
      mechanicId: entry.mechanicId,
      mechanicName: entry.mechanicName,
      quarters: roundNumber(entry.quarters),
      hours: roundNumber(entry.hours),
      targetHours: roundNumber(entry.targetHours),
      varianceHours: roundNumber(entry.varianceHours),
      fulfillmentPct,
      workdays,
      tickets,
      avgHoursPerDay: workdays > 0 ? roundNumber(entry.hours / workdays) : 0,
      avgHoursPerTicket: tickets > 0 ? roundNumber(entry.hours / tickets) : 0,
    } satisfies AdminSummaryRow;
  });

  const totalHours = rows.reduce((sum, row) => sum + row.hours, 0);
  const totalQuarters = rows.reduce((sum, row) => sum + row.quarters, 0);
  const totalTarget = rows.reduce((sum, row) => sum + row.targetHours, 0);
  const mechanicsCount = rows.length;
  const workdaysCount = new Set(filteredTotals.map((row) => row.statDate)).size;
  const fulfillmentPct = totalTarget > 0 ? totalHours / totalTarget : 0;

  return {
    rows,
    kpis: {
      totalHours: roundNumber(totalHours),
      totalQuarters: roundNumber(totalQuarters),
      totalTarget: roundNumber(totalTarget),
      fulfillmentPct,
      mechanicsCount,
      workdaysCount,
      ticketsCount: uniqueTicketIds.size,
      avgPerMechanic: mechanicsCount > 0 ? roundNumber(totalHours / mechanicsCount) : 0,
      avgPerDay: workdaysCount > 0 ? roundNumber(totalHours / workdaysCount) : 0,
    },
  };
});

function sortAdminSummaryRows(rows: AdminSummaryRow[], sort: string | undefined, dir: SortDirection | undefined) {
  const activeSort = sort ?? SUMMARY_DEFAULT_SORT;
  const direction = normalizeDirection(dir, "desc");
  const sortedRows = [...rows];

  sortedRows.sort((left, right) => {
    let result = 0;

    switch (activeSort) {
      case "mechanic":
        result = compareText(left.mechanicName, right.mechanicName);
        break;
      case "quarters":
        result = compareNumber(left.quarters, right.quarters);
        break;
      case "target":
        result = compareNumber(left.targetHours, right.targetHours);
        break;
      case "variance":
        result = compareNumber(left.varianceHours, right.varianceHours);
        break;
      case "pct":
        result = compareNumber(left.fulfillmentPct, right.fulfillmentPct);
        break;
      case "days":
        result = compareNumber(left.workdays, right.workdays);
        break;
      case "tickets":
        result = compareNumber(left.tickets, right.tickets);
        break;
      case "avgDay":
        result = compareNumber(left.avgHoursPerDay, right.avgHoursPerDay);
        break;
      case "avgTicket":
        result = compareNumber(left.avgHoursPerTicket, right.avgHoursPerTicket);
        break;
      case "hours":
      default:
        result = compareNumber(left.hours, right.hours);
        break;
    }

    if (result !== 0) {
      return applyDirection(result, direction);
    }

    return compareText(left.mechanicName, right.mechanicName);
  });

  return sortedRows;
}

function applyDetailedQueryFilters<T extends ReturnType<typeof createDetailedBaseQuery>>(query: T, filters: AdminDetailedFilters) {
  const mechanicIds = normalizeMechanicIds(filters);
  const q = normalizeQuery(filters.q);
  const ticketId = parseTicketQuery(q);
  const sanitizedQuery = q ? sanitizeOrValue(q) : undefined;

  query = query.gte("stat_date", filters.fromDate).lte("stat_date", filters.toDate);

  if (mechanicIds.length === 1) {
    query = query.eq("mechanic_id", mechanicIds[0]);
  } else if (mechanicIds.length > 1) {
    query = query.in("mechanic_id", mechanicIds);
  }

  switch (filters.status) {
    case "paid":
      query = query.not("source_payment_id", "is", null);
      break;
    case "open":
      query = query.is("source_payment_id", null);
      break;
    case "anomaly":
      query = query.not("anomaly_code", "is", null);
      break;
    default:
      break;
  }

  if (sanitizedQuery) {
    const parts = [`mechanic_item_no.ilike.%${sanitizedQuery}%`];

    if (ticketId !== null) {
      parts.push(`ticket_id.eq.${ticketId}`);
    }

    query = query.or(parts.join(","));
  }

  return query;
}

function applyDetailedOrder<T extends ReturnType<typeof createDetailedBaseQuery>>(query: T, filters: AdminDetailedFilters) {
  const sort = filters.sort ?? DETAILED_DEFAULT_SORT;
  const direction = normalizeDirection(filters.dir, "desc");
  const ascending = direction === "asc";

  switch (sort) {
    case "mechanic":
      query = query.order("mechanic_name", { referencedTable: "mechanic_item_mapping", ascending }).order("stat_date", {
        ascending: false,
      });
      break;
    case "ticket":
      query = query.order("ticket_id", { ascending });
      break;
    case "item":
      query = query.order("mechanic_item_no", { ascending });
      break;
    case "baseline":
      query = query.order("baseline_quantity", { ascending });
      break;
    case "current":
      query = query.order("current_quantity", { ascending });
      break;
    case "added":
      query = query.order("today_added_quantity", { ascending });
      break;
    case "hours":
      query = query.order("today_added_hours", { ascending });
      break;
    case "paid":
      query = query.order("source_payment_id", { ascending, nullsFirst: ascending });
      break;
    case "updated":
      query = query.order("source_updated_at", { ascending, nullsFirst: ascending });
      break;
    case "anomaly":
      query = query.order("anomaly_code", { ascending, nullsFirst: ascending });
      break;
    case "date":
    default:
      query = query.order("stat_date", { ascending });
      break;
  }

  return query.order("ticket_id", { ascending: true }).order("ticket_material_id", { ascending: true });
}

function createDetailedBaseQuery(count?: "exact") {
  const supabase = createAdminClient();

  return supabase
    .from("daily_ticket_item_baselines")
    .select(
      "mechanic_id, stat_date, ticket_id, ticket_material_id, mechanic_item_no, baseline_quantity, current_quantity, today_added_quantity, today_added_hours, source_payment_id, source_amountpaid, source_updated_at, anomaly_code, mechanic:mechanic_item_mapping(mechanic_name)",
      count ? { count } : undefined,
    );
}

function toDetailedRows(
  rows: Array<{
    mechanic_id: unknown;
    stat_date: unknown;
    ticket_id: unknown;
    ticket_material_id: unknown;
    mechanic_item_no: unknown;
    baseline_quantity: unknown;
    current_quantity: unknown;
    today_added_quantity: unknown;
    today_added_hours: unknown;
    source_payment_id: unknown;
    source_amountpaid: unknown;
    source_updated_at: unknown;
    anomaly_code: unknown;
    mechanic: { mechanic_name?: string } | null;
  }>,
) {
  return rows.map((row) => ({
    mechanicId: row.mechanic_id as string,
    statDate: row.stat_date as string,
    mechanicName: row.mechanic?.mechanic_name ?? "Unknown mechanic",
    ticketId: toNumeric(row.ticket_id),
    ticketMaterialId: toNumeric(row.ticket_material_id),
    mechanicItemNo: String(row.mechanic_item_no ?? ""),
    baselineQuantity: toNumeric(row.baseline_quantity),
    currentQuantity: toNumeric(row.current_quantity),
    todayAddedQuantity: toNumeric(row.today_added_quantity),
    hours: toNumeric(row.today_added_hours),
    paymentId: row.source_payment_id === null ? null : toNumeric(row.source_payment_id),
    amountPaid: row.source_amountpaid === null ? null : toNumeric(row.source_amountpaid),
    sourceUpdatedAt: (row.source_updated_at as string | null) ?? null,
    anomalyCode: (row.anomaly_code as string | null) ?? null,
  })) satisfies DetailedRow[];
}

function sortDetailedRows(rows: DetailedRow[], filters: Pick<AdminDetailedFilters, "sort" | "dir">) {
  const sort = filters.sort ?? DETAILED_DEFAULT_SORT;
  const direction = normalizeDirection(filters.dir, "desc");
  const sortedRows = [...rows];

  sortedRows.sort((left, right) => {
    let result = 0;

    switch (sort) {
      case "mechanic":
        result = compareText(left.mechanicName, right.mechanicName);
        break;
      case "ticket":
        result = compareNumber(left.ticketId, right.ticketId);
        break;
      case "item":
        result = compareText(left.mechanicItemNo, right.mechanicItemNo);
        break;
      case "baseline":
        result = compareNumber(left.baselineQuantity, right.baselineQuantity);
        break;
      case "current":
        result = compareNumber(left.currentQuantity, right.currentQuantity);
        break;
      case "added":
        result = compareNumber(left.todayAddedQuantity, right.todayAddedQuantity);
        break;
      case "hours":
        result = compareNumber(left.hours, right.hours);
        break;
      case "paid":
        result = compareNumber(left.paymentId === null ? 0 : 1, right.paymentId === null ? 0 : 1);
        break;
      case "updated":
        result = compareText(left.sourceUpdatedAt ?? "", right.sourceUpdatedAt ?? "");
        break;
      case "anomaly":
        result = compareText(left.anomalyCode ?? "", right.anomalyCode ?? "");
        break;
      case "date":
      default:
        result = compareText(left.statDate, right.statDate);
        break;
    }

    if (result !== 0) {
      return applyDirection(result, direction);
    }

    const byDate = compareText(left.statDate, right.statDate);
    if (byDate !== 0) {
      return applyDirection(byDate, direction);
    }

    const byTicket = compareNumber(left.ticketId, right.ticketId);
    if (byTicket !== 0) {
      return byTicket;
    }

    return compareNumber(left.ticketMaterialId, right.ticketMaterialId);
  });

  return sortedRows;
}

async function fetchDetailedRowsInternal(filters: AdminDetailedFilters, paginated: boolean): Promise<DetailedPage> {
  let query = createDetailedBaseQuery(paginated ? "exact" : undefined);
  query = applyDetailedQueryFilters(query, filters);
  query = applyDetailedOrder(query, filters);

  if (paginated) {
    const page = normalizePage(filters.page);
    const pageSize = normalizePageSize(filters.pageSize);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    query = query.range(from, to);
  }

  const { data, error, count } = await query;

  if (error) {
    throw new Error(`Failed to load detailed rows: ${error.message}`);
  }

  let rows = toDetailedRows((data ?? []) as Array<Parameters<typeof toDetailedRows>[0][number]>);
  const q = normalizeQuery(filters.q);

  if (q) {
    const lowered = q.toLocaleLowerCase("da-DK");
    rows = rows.filter(
      (row) =>
        row.mechanicName.toLocaleLowerCase("da-DK").includes(lowered) ||
        row.mechanicItemNo.toLocaleLowerCase("da-DK").includes(lowered) ||
        String(row.ticketId) === q,
    );
  }

  rows = sortDetailedRows(rows, filters);

  return {
    rows,
    total: typeof count === "number" ? count : rows.length,
  };
}

export async function getActiveMechanics(): Promise<ActiveMechanic[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("mechanic_item_mapping")
    .select("id, mechanic_name")
    .eq("active", true)
    .order("display_order", { ascending: true })
    .order("mechanic_name", { ascending: true });

  if (error) {
    throw new Error(`Failed to load mechanics: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    mechanicName: row.mechanic_name as string,
  }));
}

export async function getSummaryRows(filters: ReportFilters): Promise<SummaryRow[]> {
  const typedRows = await fetchTotalsSourceRows(filters);

  if (filters.periodMode === "daily") {
    return typedRows.map((row) => ({
      period: row.statDate,
      mechanicName: row.mechanicName,
      quarters: roundNumber(row.quartersTotal),
      hours: roundNumber(row.hoursTotal),
      targetHours: roundNumber(row.targetHours),
      varianceHours: roundNumber(row.varianceHours),
    }));
  }

  const grouped = new Map<
    string,
    { period: string; mechanicName: string; count: number; quarters: number; hours: number; targetHours: number; varianceHours: number }
  >();

  for (const row of typedRows) {
    const period = filters.periodMode === "weekly_avg" ? getWeekKey(row.statDate) : getMonthKey(row.statDate);
    const key = `${period}:${row.mechanicId}`;
    const existing = grouped.get(key) ?? {
      period,
      mechanicName: row.mechanicName,
      count: 0,
      quarters: 0,
      hours: 0,
      targetHours: 0,
      varianceHours: 0,
    };

    existing.count += 1;
    existing.quarters += row.quartersTotal;
    existing.hours += row.hoursTotal;
    existing.targetHours += row.targetHours;
    existing.varianceHours += row.varianceHours;
    grouped.set(key, existing);
  }

  return [...grouped.values()]
    .map((entry) => ({
      period: entry.period,
      mechanicName: entry.mechanicName,
      quarters: roundNumber(entry.quarters / entry.count),
      hours: roundNumber(entry.hours / entry.count),
      targetHours: roundNumber(entry.targetHours / entry.count),
      varianceHours: roundNumber(entry.varianceHours / entry.count),
    }))
    .sort((left, right) => left.period.localeCompare(right.period) || left.mechanicName.localeCompare(right.mechanicName));
}

export async function getAdminSummary(filters: AdminFilters): Promise<AdminSummaryRow[]> {
  const dataset = await loadSummaryDataset(serializeSummaryDatasetFilters(filters));
  return sortAdminSummaryRows(dataset.rows, filters.sort, filters.dir);
}

export async function getKpiSnapshot(filters: AdminFilters): Promise<KpiSnapshot> {
  const dataset = await loadSummaryDataset(serializeSummaryDatasetFilters(filters));
  return dataset.kpis;
}

export async function getDetailedRows(filters: ReportFilters | AdminDetailedFilters): Promise<DetailedRow[]> {
  const page = await fetchDetailedRowsInternal(filters, false);
  return page.rows;
}

export async function getDetailedPage(filters: AdminDetailedFilters): Promise<DetailedPage> {
  return fetchDetailedRowsInternal(filters, true);
}

function escapeCsvCell(value: string | number | null): string {
  if (value === null || value === undefined) {
    return "";
  }

  let stringValue: string;
  if (typeof value === "number") {
    stringValue = Number.isFinite(value) ? String(value).replace(".", ",") : "";
  } else {
    stringValue = String(value);
  }

  if (
    !stringValue.includes(CSV_DELIMITER) &&
    !stringValue.includes("\"") &&
    !stringValue.includes("\n") &&
    !stringValue.includes("\r")
  ) {
    return stringValue;
  }

  return `"${stringValue.replaceAll("\"", "\"\"")}"`;
}

export async function buildCsv(filters: (ReportFilters | AdminDetailedFilters) & { exportMode: ExportMode }) {
  if (filters.exportMode === "summary") {
    const rows = await getAdminSummary(filters);
    const header = [
      "Mekaniker",
      "Kvarterer",
      "Timer",
      "Mål (t)",
      "Difference (t)",
      "Opfyldelse",
      "Arbejdsdage",
      "Tickets",
      "Snit pr. dag (t)",
      "Snit pr. ticket (t)",
    ];
    const lines = rows.map((row) =>
      [
        row.mechanicName,
        row.quarters,
        row.hours,
        row.targetHours,
        row.varianceHours,
        formatPercent(row.fulfillmentPct),
        row.workdays,
        row.tickets,
        row.avgHoursPerDay,
        row.avgHoursPerTicket,
      ]
        .map(escapeCsvCell)
        .join(CSV_DELIMITER),
    );

    return CSV_BOM + [header.join(CSV_DELIMITER), ...lines].join("\r\n");
  }

  const rows = await getDetailedRows(filters);
  const header = [
    "Dato",
    "Mekaniker",
    "Ticket-ID",
    "Ticket-linje-ID",
    "Varenummer",
    "Baseline (kv)",
    "Aktuel (kv)",
    "Tilføjet (kv)",
    "Timer",
    "Betalings-ID",
    "Betalt beløb",
    "Kilde opdateret",
    "Anomali",
  ];
  const lines = rows.map((row) =>
    [
      row.statDate,
      row.mechanicName,
      row.ticketId,
      row.ticketMaterialId,
      row.mechanicItemNo,
      row.baselineQuantity,
      row.currentQuantity,
      row.todayAddedQuantity,
      row.hours,
      row.paymentId,
      row.amountPaid,
      row.sourceUpdatedAt,
      row.anomalyCode,
    ]
      .map(escapeCsvCell)
      .join(CSV_DELIMITER),
  );

  return CSV_BOM + [header.join(CSV_DELIMITER), ...lines].join("\r\n");
}

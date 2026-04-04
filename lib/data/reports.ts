import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { getMonthKey, getWeekKey } from "@/lib/time";

export type PeriodMode = "daily" | "weekly_avg" | "monthly_avg";
export type ExportMode = "summary" | "detailed";

export type ReportFilters = {
  fromDate: string;
  toDate: string;
  periodMode: PeriodMode;
  exportMode: ExportMode;
  mechanicId?: string;
};

type SummaryRow = {
  period: string;
  mechanicName: string;
  quarters: number;
  hours: number;
  targetHours: number;
  varianceHours: number;
};

type DetailedRow = {
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

function roundNumber(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function getActiveMechanics() {
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
  const supabase = createAdminClient();
  let query = supabase
    .from("daily_mechanic_totals")
    .select("stat_date, mechanic_id, quarters_total, hours_total, target_hours, variance_hours, mechanic:mechanic_item_mapping(mechanic_name)")
    .gte("stat_date", filters.fromDate)
    .lte("stat_date", filters.toDate)
    .order("stat_date", { ascending: true });

  if (filters.mechanicId) {
    query = query.eq("mechanic_id", filters.mechanicId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to load summary rows: ${error.message}`);
  }

  const typedRows = (data ?? []).map((row) => ({
    statDate: row.stat_date as string,
    mechanicId: row.mechanic_id as string,
    mechanicName: ((row.mechanic as { mechanic_name?: string } | null)?.mechanic_name ?? "Unknown mechanic") as string,
    quartersTotal: Number(row.quarters_total ?? 0),
    hoursTotal: Number(row.hours_total ?? 0),
    targetHours: Number(row.target_hours ?? 8),
    varianceHours: Number(row.variance_hours ?? 0),
  }));

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

export async function getDetailedRows(filters: ReportFilters): Promise<DetailedRow[]> {
  const supabase = createAdminClient();
  let query = supabase
    .from("daily_ticket_item_baselines")
    .select(
      "stat_date, ticket_id, ticket_material_id, mechanic_item_no, baseline_quantity, current_quantity, today_added_quantity, today_added_hours, source_payment_id, source_amountpaid, source_updated_at, anomaly_code, mechanic:mechanic_item_mapping(mechanic_name)",
    )
    .gte("stat_date", filters.fromDate)
    .lte("stat_date", filters.toDate)
    .order("stat_date", { ascending: false })
    .order("ticket_id", { ascending: true });

  if (filters.mechanicId) {
    query = query.eq("mechanic_id", filters.mechanicId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to load detailed rows: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    statDate: row.stat_date as string,
    mechanicName: ((row.mechanic as { mechanic_name?: string } | null)?.mechanic_name ?? "Unknown mechanic") as string,
    ticketId: Number(row.ticket_id),
    ticketMaterialId: Number(row.ticket_material_id),
    mechanicItemNo: row.mechanic_item_no as string,
    baselineQuantity: Number(row.baseline_quantity ?? 0),
    currentQuantity: Number(row.current_quantity ?? 0),
    todayAddedQuantity: Number(row.today_added_quantity ?? 0),
    hours: Number(row.today_added_hours ?? 0),
    paymentId: row.source_payment_id === null ? null : Number(row.source_payment_id),
    amountPaid: row.source_amountpaid === null ? null : Number(row.source_amountpaid),
    sourceUpdatedAt: (row.source_updated_at as string | null) ?? null,
    anomalyCode: (row.anomaly_code as string | null) ?? null,
  }));
}

const CSV_DELIMITER = ";";
const CSV_BOM = "\uFEFF";

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

export async function buildCsv(filters: ReportFilters) {
  if (filters.exportMode === "summary") {
    const rows = await getSummaryRows(filters);
    const header = ["Periode", "Mekaniker", "Kvarterer", "Timer", "Mål (t)", "Difference (t)"];
    const lines = rows.map((row) =>
      [row.period, row.mechanicName, row.quarters, row.hours, row.targetHours, row.varianceHours]
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
    "Baseline",
    "Aktuel",
    "Tilføjet i dag",
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

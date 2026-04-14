import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { getDailyTargetHoursForDate, getTargetHoursBetween } from "@/lib/targets";
import {
  addDays,
  countWeekdaysBetween,
  formatCopenhagenDate,
  formatShortDateRange,
  getCopenhagenDateString,
  getStartOfMonth,
  getStartOfWeek,
} from "@/lib/time";

type TotalRow = {
  mechanic_id: string;
  hours_total: number;
  quarters_total: number;
};

type MechanicMappingRow = {
  id: string;
  mechanic_name: string;
  display_order: number;
};

type AggregatedTotalRow = {
  mechanic_id: string;
  hours_total: number;
  quarters_total: number;
};

export type DashboardBoardType =
  | "today"
  | "last_week"
  | "last_month"
  | "current_week"
  | "current_month"
  | "mechanic_focus"
  | "revenue_today"
  | "revenue_current_week"
  | "revenue_current_month";

export type DashboardFocusMetricKey = "today" | "current_week" | "current_month";

export const DASHBOARD_FOCUS_METRIC_OPTIONS: Array<{ key: DashboardFocusMetricKey; label: string }> = [
  { key: "today", label: "I dag" },
  { key: "current_week", label: "Aktuel uge" },
  { key: "current_month", label: "Aktuel måned" },
];

export type DashboardViewSetting = {
  boardType: DashboardBoardType;
  boardTitle: string;
  displayOrder: number;
  durationSeconds: number;
  active: boolean;
  selectedMechanicIds: string[];
  selectedFocusMetricKeys: DashboardFocusMetricKey[];
  updatedAt: string;
};

export type DashboardBarRow = {
  id: string;
  mechanicName: string;
  targetHours: number;
  hours: number;
  quarters: number;
};

export type DashboardPeriodBoard = {
  kind: "period";
  key: DashboardBoardType;
  title: string;
  subtitle: string;
  rangeLabel: string;
  durationSeconds: number;
  rows: DashboardBarRow[];
};

export type DashboardFocusMetric = {
  key: DashboardFocusMetricKey;
  label: string;
  hours: number;
  quarters: number;
  targetHours: number;
};

const DEFAULT_FOCUS_METRIC_KEYS = DASHBOARD_FOCUS_METRIC_OPTIONS.map((option) => option.key);

export type DashboardFocusMechanic = {
  id: string;
  mechanicName: string;
  metrics: DashboardFocusMetric[];
};

export type DashboardFocusBoard = {
  kind: "focus";
  key: DashboardBoardType;
  title: string;
  subtitle: string;
  rangeLabel: string;
  durationSeconds: number;
  mechanics: DashboardFocusMechanic[];
};

export type DashboardRevenueMetricKey = "arbeidstid" | "repair" | "cykelplus";

export type DashboardRevenueBar = {
  key: DashboardRevenueMetricKey;
  label: string;
  value: number;
  targetValue: number;
  isCurrency: boolean;
};

export type DashboardRevenueBoard = {
  kind: "revenue";
  key: DashboardBoardType;
  title: string;
  rangeLabel: string;
  durationSeconds: number;
  bars: DashboardRevenueBar[];
};

export type DashboardBoard = DashboardPeriodBoard | DashboardFocusBoard | DashboardRevenueBoard;

export type DashboardPresentation = {
  statDate: string;
  statDateLabel: string;
  latestSync: DashboardLatestSync | null;
  refreshToken: string;
  boards: DashboardBoard[];
};

type DashboardWindow = {
  title: string;
  subtitle: string;
  fromDate: string;
  toDate: string;
};

const DEFAULT_VIEW_SETTINGS: DashboardViewSetting[] = [
  {
    boardType: "today",
    boardTitle: "I dag",
    displayOrder: 0,
    durationSeconds: 20,
    active: true,
    selectedMechanicIds: [],
    selectedFocusMetricKeys: DEFAULT_FOCUS_METRIC_KEYS,
    updatedAt: "1970-01-01T00:00:00.000Z",
  },
  {
    boardType: "last_week",
    boardTitle: "Seneste uge",
    displayOrder: 1,
    durationSeconds: 20,
    active: true,
    selectedMechanicIds: [],
    selectedFocusMetricKeys: DEFAULT_FOCUS_METRIC_KEYS,
    updatedAt: "1970-01-01T00:00:00.000Z",
  },
  {
    boardType: "last_month",
    boardTitle: "Seneste måned",
    displayOrder: 2,
    durationSeconds: 20,
    active: true,
    selectedMechanicIds: [],
    selectedFocusMetricKeys: DEFAULT_FOCUS_METRIC_KEYS,
    updatedAt: "1970-01-01T00:00:00.000Z",
  },
  {
    boardType: "current_week",
    boardTitle: "Aktuel uge",
    displayOrder: 3,
    durationSeconds: 20,
    active: true,
    selectedMechanicIds: [],
    selectedFocusMetricKeys: DEFAULT_FOCUS_METRIC_KEYS,
    updatedAt: "1970-01-01T00:00:00.000Z",
  },
  {
    boardType: "current_month",
    boardTitle: "Aktuel måned",
    displayOrder: 4,
    durationSeconds: 20,
    active: true,
    selectedMechanicIds: [],
    selectedFocusMetricKeys: DEFAULT_FOCUS_METRIC_KEYS,
    updatedAt: "1970-01-01T00:00:00.000Z",
  },
  {
    boardType: "mechanic_focus",
    boardTitle: "Mekaniker-fokus",
    displayOrder: 5,
    durationSeconds: 20,
    active: false,
    selectedMechanicIds: [],
    selectedFocusMetricKeys: DEFAULT_FOCUS_METRIC_KEYS,
    updatedAt: "1970-01-01T00:00:00.000Z",
  },
];

function normalizeFocusMetricKeys(keys: string[] | null | undefined): DashboardFocusMetricKey[] {
  const normalized = (keys ?? []).filter((key): key is DashboardFocusMetricKey =>
    DASHBOARD_FOCUS_METRIC_OPTIONS.some((option) => option.key === key),
  );

  if (normalized.length >= 2 && normalized.length <= 3) {
    return normalized;
  }

  return DEFAULT_FOCUS_METRIC_KEYS;
}

export type DashboardLatestSync = {
  finishedAt: string | null;
  status: string;
  mode: string;
  message: string | null;
  refreshToken: string | null;
};

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getDashboardWindow(boardType: DashboardBoardType, today = getCopenhagenDateString()): DashboardWindow {
  switch (boardType) {
    case "last_week": {
      const toDate = addDays(today, -1);
      const fromDate = addDays(today, -7);
      return {
        title: "Seneste uge",
        subtitle: "Seneste 7 dage",
        fromDate,
        toDate,
      };
    }
    case "last_month": {
      const toDate = addDays(today, -1);
      const fromDate = addDays(today, -30);
      return {
        title: "Seneste måned",
        subtitle: "Seneste 30 dage",
        fromDate,
        toDate,
      };
    }
    case "current_week":
      return {
        title: "Aktuel uge",
        subtitle: "Mandag til i dag",
        fromDate: getStartOfWeek(today),
        toDate: today,
      };
    case "current_month":
      return {
        title: "Aktuel måned",
        subtitle: "Denne måned til dato",
        fromDate: getStartOfMonth(today),
        toDate: today,
      };
    case "mechanic_focus":
      return {
        title: "Mekaniker-fokus",
        subtitle: "I dag, aktuel uge og aktuel måned",
        fromDate: today,
        toDate: today,
      };
    case "revenue_today":
      return {
        title: "Omsætning i dag",
        subtitle: "Dagens omsætning",
        fromDate: today,
        toDate: today,
      };
    case "revenue_current_week":
      return {
        title: "Omsætning aktuel uge",
        subtitle: "Mandag til i dag",
        fromDate: getStartOfWeek(today),
        toDate: today,
      };
    case "revenue_current_month":
      return {
        title: "Omsætning aktuel måned",
        subtitle: "Denne måned til dato",
        fromDate: getStartOfMonth(today),
        toDate: today,
      };
    case "today":
    default:
      return {
        title: "I dag",
        subtitle: "Dagens registreringer",
        fromDate: today,
        toDate: today,
      };
  }
}

function toLatestSync(row: {
  finished_at?: string | null;
  status?: string | null;
  sync_type?: string | null;
  message?: string | null;
} | null): DashboardLatestSync | null {
  if (!row) {
    return null;
  }

  const finishedAt = row.finished_at ?? null;
  const status = row.status ?? "unknown";
  const mode = row.sync_type ?? "unknown";
  const message = row.message ?? null;

  return {
    finishedAt,
    status,
    mode,
    message,
    refreshToken: finishedAt ? `${mode}:${status}:${finishedAt}` : `${mode}:${status}:pending`,
  };
}

export async function getLatestDashboardSync() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("sync_event_log")
    .select("finished_at, status, sync_type, message")
    .eq("sync_type", "sync")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load latest sync: ${error.message}`);
  }

  return toLatestSync(data);
}

export async function getDashboardViewSettings(): Promise<DashboardViewSetting[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("dashboard_view_settings")
    .select("board_type, board_title, display_order, duration_seconds, active, selected_mechanic_ids, selected_focus_metric_keys, updated_at")
    .order("display_order", { ascending: true });

  if (error) {
    throw new Error(`Failed to load dashboard view settings: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return DEFAULT_VIEW_SETTINGS;
  }

  return (data as Array<{
    board_type: DashboardBoardType;
    board_title: string;
    display_order: number;
    duration_seconds: number;
    active: boolean;
    selected_mechanic_ids: string[] | null;
    selected_focus_metric_keys: DashboardFocusMetricKey[] | null;
    updated_at: string;
  }>).map((row) => ({
    boardType: row.board_type,
    boardTitle: row.board_title,
    displayOrder: row.display_order,
    durationSeconds: Math.max(5, Number(row.duration_seconds ?? 20)),
    active: Boolean(row.active),
    selectedMechanicIds: row.selected_mechanic_ids ?? [],
    selectedFocusMetricKeys: normalizeFocusMetricKeys(row.selected_focus_metric_keys),
    updatedAt: row.updated_at,
  }));
}

async function getMechanicMappings(): Promise<MechanicMappingRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("mechanic_item_mapping")
    .select("id, mechanic_name, display_order")
    .eq("active", true)
    .order("display_order", { ascending: true })
    .order("mechanic_name", { ascending: true });

  if (error) {
    throw new Error(`Failed to load mechanic mappings: ${error.message}`);
  }

  return (data ?? []) as MechanicMappingRow[];
}

async function getAggregatedTotals(fromDate: string, toDate: string): Promise<Map<string, AggregatedTotalRow>> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("daily_mechanic_totals")
    .select("mechanic_id, hours_total, quarters_total")
    .gte("stat_date", fromDate)
    .lte("stat_date", toDate);

  if (error) {
    throw new Error(`Failed to load aggregated dashboard totals: ${error.message}`);
  }

  const totals = new Map<string, AggregatedTotalRow>();

  for (const row of (data ?? []) as TotalRow[]) {
    const current = totals.get(row.mechanic_id) ?? {
      mechanic_id: row.mechanic_id,
      hours_total: 0,
      quarters_total: 0,
    };

    current.hours_total += toNumber(row.hours_total);
    current.quarters_total += toNumber(row.quarters_total);
    totals.set(row.mechanic_id, current);
  }

  return totals;
}

function buildPeriodRows(mappings: MechanicMappingRow[], totals: Map<string, AggregatedTotalRow>, targetHours: number) {
  return mappings.map((mapping) => {
    const total = totals.get(mapping.id);

    return {
      id: mapping.id,
      mechanicName: mapping.mechanic_name,
      targetHours,
      hours: toNumber(total?.hours_total),
      quarters: toNumber(total?.quarters_total),
    } satisfies DashboardBarRow;
  });
}

async function buildPeriodBoard(setting: DashboardViewSetting, mappings: MechanicMappingRow[], today: string): Promise<DashboardPeriodBoard> {
  const window = getDashboardWindow(setting.boardType, today);
  const [totals, targetHours] = await Promise.all([getAggregatedTotals(window.fromDate, window.toDate), getTargetHoursBetween(window.fromDate, window.toDate)]);

  return {
    kind: "period",
    key: setting.boardType,
    title: setting.boardTitle || window.title,
    subtitle: window.subtitle,
    rangeLabel: formatShortDateRange(window.fromDate, window.toDate),
    durationSeconds: setting.durationSeconds,
    rows: buildPeriodRows(mappings, totals, targetHours),
  };
}

async function buildFocusBoard(setting: DashboardViewSetting, mappings: MechanicMappingRow[], today: string): Promise<DashboardFocusBoard> {
  const currentWeek = getDashboardWindow("current_week", today);
  const currentMonth = getDashboardWindow("current_month", today);
  const selectedMetricKeys = normalizeFocusMetricKeys(setting.selectedFocusMetricKeys);

  const [todayTotals, weekTotals, monthTotals, todayTargetHours, weekTargetHours, monthTargetHours] = await Promise.all([
    getAggregatedTotals(today, today),
    getAggregatedTotals(currentWeek.fromDate, currentWeek.toDate),
    getAggregatedTotals(currentMonth.fromDate, currentMonth.toDate),
    getDailyTargetHoursForDate(today),
    getTargetHoursBetween(currentWeek.fromDate, currentWeek.toDate),
    getTargetHoursBetween(currentMonth.fromDate, currentMonth.toDate),
  ]);

  const selectedMechanics = mappings.filter((mapping) => setting.selectedMechanicIds.includes(mapping.id));

  return {
    kind: "focus",
    key: setting.boardType,
    title: setting.boardTitle || "Mekaniker-fokus",
    subtitle: "2-3 søjler pr. valgt mekaniker",
    rangeLabel: selectedMetricKeys
      .map((metricKey) => {
        switch (metricKey) {
          case "today":
            return formatShortDateRange(today, today);
          case "current_week":
            return formatShortDateRange(currentWeek.fromDate, currentWeek.toDate);
          case "current_month":
            return formatShortDateRange(currentMonth.fromDate, currentMonth.toDate);
        }
      })
      .join(" · "),
    durationSeconds: setting.durationSeconds,
    mechanics: selectedMechanics.map((mapping) => ({
      id: mapping.id,
      mechanicName: mapping.mechanic_name,
      metrics: selectedMetricKeys.map((metricKey) => {
        switch (metricKey) {
          case "today":
            return {
              key: "today",
              label: "I dag",
              hours: toNumber(todayTotals.get(mapping.id)?.hours_total),
              quarters: toNumber(todayTotals.get(mapping.id)?.quarters_total),
              targetHours: todayTargetHours,
            } satisfies DashboardFocusMetric;
          case "current_week":
            return {
              key: "current_week",
              label: "Aktuel uge",
              hours: toNumber(weekTotals.get(mapping.id)?.hours_total),
              quarters: toNumber(weekTotals.get(mapping.id)?.quarters_total),
              targetHours: weekTargetHours,
            } satisfies DashboardFocusMetric;
          case "current_month":
            return {
              key: "current_month",
              label: "Aktuel måned",
              hours: toNumber(monthTotals.get(mapping.id)?.hours_total),
              quarters: toNumber(monthTotals.get(mapping.id)?.quarters_total),
              targetHours: monthTargetHours,
            } satisfies DashboardFocusMetric;
        }
      }),
    })),
  };
}

type RevenueKpiTargetsRow = {
  metric_key: string;
  daily_target: number;
};

async function getRevenueKpiTargets(): Promise<Map<string, number>> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("revenue_kpi_targets")
    .select("metric_key, daily_target");

  if (error) {
    throw new Error(`Failed to load revenue KPI targets: ${error.message}`);
  }

  const map = new Map<string, number>();
  for (const row of (data ?? []) as RevenueKpiTargetsRow[]) {
    map.set(row.metric_key, toNumber(row.daily_target));
  }

  return map;
}

async function getRevenueTotals(fromDate: string, toDate: string): Promise<{ arbeidstid: number; repair: number }> {
  const supabase = createAdminClient();

  // Query payments by their actual payment_date (not sync date)
  const { data, error } = await supabase
    .from("daily_payment_summary")
    .select("mechanic_total_incl_vat, ticket_total_incl_vat, is_repair")
    .gte("payment_date", fromDate)
    .lte("payment_date", toDate);

  if (error) {
    throw new Error(`Failed to load payment revenue: ${error.message}`);
  }

  const rows = (data ?? []) as Array<{
    mechanic_total_incl_vat: unknown;
    ticket_total_incl_vat: unknown;
    is_repair: unknown;
  }>;

  const arbeidstid = rows.reduce((sum, row) => sum + toNumber(row.mechanic_total_incl_vat), 0);
  const repair = rows
    .filter((row) => Boolean(row.is_repair))
    .reduce((sum, row) => sum + toNumber(row.ticket_total_incl_vat), 0);

  return { arbeidstid, repair };
}

async function getLatestCykelPlusCount(): Promise<number> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("cykelplus_snapshots")
    .select("customer_count")
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load CykelPlus count: ${error.message}`);
  }

  return toNumber((data as { customer_count: unknown } | null)?.customer_count);
}

async function buildRevenueBoard(setting: DashboardViewSetting, today: string): Promise<DashboardRevenueBoard> {
  const window = getDashboardWindow(setting.boardType, today);
  const [revenueTotals, cykelPlusCount, kpiTargets] = await Promise.all([
    getRevenueTotals(window.fromDate, window.toDate),
    getLatestCykelPlusCount(),
    getRevenueKpiTargets(),
  ]);

  const periodWorkdays = countWeekdaysBetween(window.fromDate, window.toDate);

  const dailyArbeidstidTarget = kpiTargets.get("arbeidstid") ?? 0;
  const dailyRepairTarget = kpiTargets.get("repair") ?? 0;
  const dailyCykelPlusTarget = kpiTargets.get("cykelplus") ?? 0;

  const scaledArbeidstid = dailyArbeidstidTarget * Math.max(periodWorkdays, 1);
  const scaledRepair = dailyRepairTarget * Math.max(periodWorkdays, 1);
  const scaledCykelPlus = dailyCykelPlusTarget;

  return {
    kind: "revenue",
    key: setting.boardType,
    title: setting.boardTitle || window.title,
    rangeLabel: formatShortDateRange(window.fromDate, window.toDate),
    durationSeconds: setting.durationSeconds,
    bars: [
      {
        key: "arbeidstid",
        label: "Mekaniker tid (kassen)",
        value: revenueTotals.arbeidstid,
        targetValue: scaledArbeidstid,
        isCurrency: true,
      },
      {
        key: "repair",
        label: "Total reparationspris (kassen)",
        value: revenueTotals.repair,
        targetValue: scaledRepair,
        isCurrency: true,
      },
      {
        key: "cykelplus",
        label: "CykelPlus kunder",
        value: cykelPlusCount,
        targetValue: scaledCykelPlus,
        isCurrency: false,
      },
    ],
  };
}

export async function getDashboardPresentation(): Promise<DashboardPresentation> {
  const statDate = getCopenhagenDateString();
  const [mappings, latestSync, settings] = await Promise.all([
    getMechanicMappings(),
    getLatestDashboardSync(),
    getDashboardViewSettings(),
  ]);

  const activeSettings = settings.filter((setting) => setting.active).sort((left, right) => left.displayOrder - right.displayOrder);
  const resolvedSettings = activeSettings.length > 0 ? activeSettings : DEFAULT_VIEW_SETTINGS.filter((setting) => setting.active);
  const boards = await Promise.all(
    resolvedSettings.map((setting) => {
      if (setting.boardType === "mechanic_focus") {
        return buildFocusBoard(setting, mappings, statDate);
      }

      if (setting.boardType === "revenue_today" || setting.boardType === "revenue_current_week" || setting.boardType === "revenue_current_month") {
        return buildRevenueBoard(setting, statDate);
      }

      return buildPeriodBoard(setting, mappings, statDate);
    }),
  );
  const latestSettingUpdate = settings.reduce<string | null>((current, setting) => {
    if (!current || setting.updatedAt > current) {
      return setting.updatedAt;
    }

    return current;
  }, null);

  return {
    statDate,
    statDateLabel: formatCopenhagenDate(statDate),
    latestSync,
    refreshToken: `${latestSync?.refreshToken ?? "sync:pending"}:${latestSettingUpdate ?? "settings:none"}`,
    boards,
  };
}

export async function getDashboardData() {
  const presentation = await getDashboardPresentation();
  const todayBoard = presentation.boards.find((board) => board.key === "today" && board.kind === "period");
  const rows = todayBoard?.kind === "period" ? todayBoard.rows : [];

  return {
    statDate: presentation.statDate,
    statDateLabel: presentation.statDateLabel,
    rows,
    latestSync: presentation.latestSync,
  };
}

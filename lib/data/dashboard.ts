import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
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
  daily_target_hours: number;
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
  | "mechanic_focus";

export type DashboardViewSetting = {
  boardType: DashboardBoardType;
  boardTitle: string;
  displayOrder: number;
  durationSeconds: number;
  active: boolean;
  selectedMechanicIds: string[];
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
  key: "today" | "current_week" | "current_month";
  label: string;
  hours: number;
  quarters: number;
  targetHours: number;
};

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

export type DashboardBoard = DashboardPeriodBoard | DashboardFocusBoard;

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
    updatedAt: "1970-01-01T00:00:00.000Z",
  },
  {
    boardType: "last_week",
    boardTitle: "Seneste uge",
    displayOrder: 1,
    durationSeconds: 20,
    active: true,
    selectedMechanicIds: [],
    updatedAt: "1970-01-01T00:00:00.000Z",
  },
  {
    boardType: "last_month",
    boardTitle: "Seneste måned",
    displayOrder: 2,
    durationSeconds: 20,
    active: true,
    selectedMechanicIds: [],
    updatedAt: "1970-01-01T00:00:00.000Z",
  },
  {
    boardType: "current_week",
    boardTitle: "Aktuel uge",
    displayOrder: 3,
    durationSeconds: 20,
    active: true,
    selectedMechanicIds: [],
    updatedAt: "1970-01-01T00:00:00.000Z",
  },
  {
    boardType: "current_month",
    boardTitle: "Aktuel måned",
    displayOrder: 4,
    durationSeconds: 20,
    active: true,
    selectedMechanicIds: [],
    updatedAt: "1970-01-01T00:00:00.000Z",
  },
  {
    boardType: "mechanic_focus",
    boardTitle: "Mekaniker-fokus",
    displayOrder: 5,
    durationSeconds: 20,
    active: false,
    selectedMechanicIds: [],
    updatedAt: "1970-01-01T00:00:00.000Z",
  },
];

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
    .select("board_type, board_title, display_order, duration_seconds, active, selected_mechanic_ids, updated_at")
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
    updated_at: string;
  }>).map((row) => ({
    boardType: row.board_type,
    boardTitle: row.board_title,
    displayOrder: row.display_order,
    durationSeconds: Math.max(5, Number(row.duration_seconds ?? 20)),
    active: Boolean(row.active),
    selectedMechanicIds: row.selected_mechanic_ids ?? [],
    updatedAt: row.updated_at,
  }));
}

async function getMechanicMappings(): Promise<MechanicMappingRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("mechanic_item_mapping")
    .select("id, mechanic_name, display_order, daily_target_hours")
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

function buildPeriodRows(mappings: MechanicMappingRow[], totals: Map<string, AggregatedTotalRow>, fromDate: string, toDate: string) {
  const workdays = countWeekdaysBetween(fromDate, toDate);

  return mappings.map((mapping) => {
    const total = totals.get(mapping.id);
    const targetHours = workdays * toNumber(mapping.daily_target_hours);

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
  const totals = await getAggregatedTotals(window.fromDate, window.toDate);

  return {
    kind: "period",
    key: setting.boardType,
    title: setting.boardTitle || window.title,
    subtitle: window.subtitle,
    rangeLabel: formatShortDateRange(window.fromDate, window.toDate),
    durationSeconds: setting.durationSeconds,
    rows: buildPeriodRows(mappings, totals, window.fromDate, window.toDate),
  };
}

async function buildFocusBoard(setting: DashboardViewSetting, mappings: MechanicMappingRow[], today: string): Promise<DashboardFocusBoard> {
  const currentWeek = getDashboardWindow("current_week", today);
  const currentMonth = getDashboardWindow("current_month", today);

  const [todayTotals, weekTotals, monthTotals] = await Promise.all([
    getAggregatedTotals(today, today),
    getAggregatedTotals(currentWeek.fromDate, currentWeek.toDate),
    getAggregatedTotals(currentMonth.fromDate, currentMonth.toDate),
  ]);

  const selectedMechanics = mappings.filter((mapping) => setting.selectedMechanicIds.includes(mapping.id));

  return {
    kind: "focus",
    key: setting.boardType,
    title: setting.boardTitle || "Mekaniker-fokus",
    subtitle: "Tre søjler pr. valgt mekaniker",
    rangeLabel: `${formatShortDateRange(today, today)} · ${formatShortDateRange(currentWeek.fromDate, currentWeek.toDate)} · ${formatShortDateRange(currentMonth.fromDate, currentMonth.toDate)}`,
    durationSeconds: setting.durationSeconds,
    mechanics: selectedMechanics.map((mapping) => ({
      id: mapping.id,
      mechanicName: mapping.mechanic_name,
      metrics: [
        {
          key: "today",
          label: "I dag",
          hours: toNumber(todayTotals.get(mapping.id)?.hours_total),
          quarters: toNumber(todayTotals.get(mapping.id)?.quarters_total),
          targetHours: toNumber(mapping.daily_target_hours),
        },
        {
          key: "current_week",
          label: "Aktuel uge",
          hours: toNumber(weekTotals.get(mapping.id)?.hours_total),
          quarters: toNumber(weekTotals.get(mapping.id)?.quarters_total),
          targetHours: countWeekdaysBetween(currentWeek.fromDate, currentWeek.toDate) * toNumber(mapping.daily_target_hours),
        },
        {
          key: "current_month",
          label: "Aktuel måned",
          hours: toNumber(monthTotals.get(mapping.id)?.hours_total),
          quarters: toNumber(monthTotals.get(mapping.id)?.quarters_total),
          targetHours: countWeekdaysBetween(currentMonth.fromDate, currentMonth.toDate) * toNumber(mapping.daily_target_hours),
        },
      ],
    })),
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
    resolvedSettings.map((setting) =>
      setting.boardType === "mechanic_focus"
        ? buildFocusBoard(setting, mappings, statDate)
        : buildPeriodBoard(setting, mappings, statDate),
    ),
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

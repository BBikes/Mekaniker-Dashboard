import { afterEach, describe, expect, it, vi } from "vitest";

type TableRow = Record<string, unknown>;
type DbState = Record<string, TableRow[]>;

function compareValues(left: unknown, right: unknown) {
  if (left === right) {
    return 0;
  }

  if (left === undefined || left === null) {
    return -1;
  }

  if (right === undefined || right === null) {
    return 1;
  }

  if (typeof left === "number" && typeof right === "number") {
    return left < right ? -1 : 1;
  }

  return String(left).localeCompare(String(right), "en");
}

class MockQuery {
  private readonly filters: Array<(row: TableRow) => boolean> = [];
  private readonly sorters: Array<{ column: string; ascending: boolean }> = [];
  private rowLimit: number | null = null;

  constructor(
    private readonly table: string,
    private readonly state: DbState,
  ) {}

  select(_columns: string, _options?: Record<string, unknown>) {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  gte(column: string, value: unknown) {
    this.filters.push((row) => compareValues(row[column], value) >= 0);
    return this;
  }

  lte(column: string, value: unknown) {
    this.filters.push((row) => compareValues(row[column], value) <= 0);
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.push((row) => row[column] !== value);
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.sorters.push({ column, ascending: options?.ascending !== false });
    return this;
  }

  limit(count: number) {
    this.rowLimit = count;
    return this;
  }

  async maybeSingle() {
    const rows = this.resolveRows();
    return { data: rows[0] ?? null, error: null };
  }

  async single() {
    const rows = this.resolveRows();
    return { data: rows[0] ?? null, error: null };
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?:
      | ((value: { count: number | null; data: TableRow[]; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve({ count: null, data: this.resolveRows(), error: null }).then(onfulfilled, onrejected);
  }

  private resolveRows() {
    let rows = [...(this.state[this.table] ?? [])].filter((row) => this.filters.every((filter) => filter(row)));

    for (const sorter of [...this.sorters].reverse()) {
      rows.sort((left, right) => {
        const result = compareValues(left[sorter.column], right[sorter.column]);
        return sorter.ascending ? result : -result;
      });
    }

    if (typeof this.rowLimit === "number") {
      rows = rows.slice(0, this.rowLimit);
    }

    return rows.map((row) => ({ ...row }));
  }
}

async function loadModules(state: DbState) {
  vi.resetModules();
  vi.doMock("server-only", () => ({}));
  vi.doMock("@/lib/supabase/server", () => ({
    createAdminClient: () => ({
      from(table: string) {
        return new MockQuery(table, state);
      },
    }),
  }));
  vi.doMock("@/lib/targets", () => ({
    getDailyTargetHoursForDate: async () => 8,
    getTargetHoursBetween: async () => 8,
  }));
  vi.doMock("@/lib/time", async () => {
    const actual = await vi.importActual<typeof import("@/lib/time")>("@/lib/time");
    return {
      ...actual,
      getCopenhagenDateString: () => "2026-04-14",
    };
  });

  const dashboard = await import("@/lib/data/dashboard");
  const reports = await import("@/lib/data/reports");
  return { dashboard, reports };
}

afterEach(() => {
  vi.resetModules();
  vi.unmock("server-only");
  vi.unmock("@/lib/supabase/server");
  vi.unmock("@/lib/targets");
  vi.unmock("@/lib/time");
});

describe("dashboard/report regressions", () => {
  it("keeps today board, focus board, and reports aligned for 8 quarters = 2 hours", async () => {
    const state: DbState = {
      mechanic_item_mapping: [
        {
          id: "m-1",
          mechanic_name: "Alice",
          display_order: 0,
          active: true,
        },
      ],
      daily_mechanic_totals: [
        {
          // Yesterday (2026-04-13) — queried by the dashboard "today" board and focus board
          stat_date: "2026-04-13",
          mechanic_id: "m-1",
          quarters_total: 8,
          hours_total: 2,
          target_hours: 8,
          variance_hours: -6,
          mechanic: { mechanic_name: "Alice" },
        },
        {
          // Today (2026-04-14) — queried by the reports (explicit date range)
          stat_date: "2026-04-14",
          mechanic_id: "m-1",
          quarters_total: 8,
          hours_total: 2,
          target_hours: 8,
          variance_hours: -6,
          mechanic: { mechanic_name: "Alice" },
        },
      ],
      daily_ticket_item_baselines: [
        {
          stat_date: "2026-04-14",
          source_stat_date: "2026-04-14",
          source_decision_reason: "included_matching_source_date",
          source_sync_event_id: "sync-log-1",
          mechanic_id: "m-1",
          ticket_id: 500,
          ticket_material_id: 11,
          mechanic_item_no: "MEK-ALICE",
          baseline_quantity: 0,
          current_quantity: 10,
          today_added_quantity: 10,
          today_added_hours: 2.5,
          source_payment_id: null,
          source_amountpaid: null,
          source_updated_at: "2026-04-14T10:00:00.000Z",
          anomaly_code: null,
          mechanic: { mechanic_name: "Alice" },
        },
        {
          stat_date: "2026-04-14",
          source_stat_date: "2026-04-14",
          source_decision_reason: "included_matching_source_date",
          source_sync_event_id: "sync-log-1",
          mechanic_id: "m-1",
          ticket_id: 501,
          ticket_material_id: 12,
          mechanic_item_no: "MEK-ALICE",
          baseline_quantity: 5,
          current_quantity: 3,
          today_added_quantity: -2,
          today_added_hours: -0.5,
          source_payment_id: null,
          source_amountpaid: null,
          source_updated_at: "2026-04-14T10:05:00.000Z",
          anomaly_code: "below_baseline_correction",
          mechanic: { mechanic_name: "Alice" },
        },
      ],
      dashboard_view_settings: [
        {
          board_type: "today",
          board_title: "I går",
          display_order: 0,
          duration_seconds: 20,
          active: true,
          selected_mechanic_ids: [],
          selected_focus_metric_keys: ["today"],
          updated_at: "2026-04-14T09:00:00.000Z",
        },
        {
          board_type: "mechanic_focus",
          board_title: "Fokus",
          display_order: 1,
          duration_seconds: 20,
          active: true,
          selected_mechanic_ids: ["m-1"],
          selected_focus_metric_keys: ["today"],
          updated_at: "2026-04-14T09:00:00.000Z",
        },
      ],
      sync_event_log: [
        {
          sync_type: "sync",
          status: "completed",
          started_at: "2026-04-14T10:00:00.000Z",
          finished_at: "2026-04-14T10:15:00.000Z",
          message: "sync completed",
        },
      ],
    };

    const { dashboard, reports } = await loadModules(state);
    const presentation = await dashboard.getDashboardPresentation();
    const summary = await reports.getAdminSummary({
      fromDate: "2026-04-14",
      toDate: "2026-04-14",
      periodMode: "daily",
    });
    const detailedRows = await reports.getDetailedRows({
      fromDate: "2026-04-14",
      toDate: "2026-04-14",
      periodMode: "daily",
      exportMode: "detailed",
    });

    const todayBoard = presentation.boards.find((board) => board.key === "today" && board.kind === "period");
    const focusBoard = presentation.boards.find((board) => board.key === "mechanic_focus" && board.kind === "focus");

    expect(todayBoard).toMatchObject({
      rows: [
        {
          id: "m-1",
          mechanicName: "Alice",
          quarters: 8,
          hours: 2,
        },
      ],
    });
    expect(focusBoard).toEqual(
      expect.objectContaining({
        mechanics: [
          expect.objectContaining({
            id: "m-1",
            metrics: expect.arrayContaining([
              expect.objectContaining({
                key: "today",
                quarters: 8,
                hours: 2,
              }),
            ]),
          }),
        ],
      }),
    );
    expect(summary).toEqual([
      expect.objectContaining({
        mechanicId: "m-1",
        mechanicName: "Alice",
        quarters: 8,
        hours: 2,
      }),
    ]);
    expect(detailedRows).toEqual([
      expect.objectContaining({
        ticketId: 500,
        ticketMaterialId: 11,
        todayAddedQuantity: 10,
        sourceStatDate: "2026-04-14",
        sourceDecisionReason: "included_matching_source_date",
        sourceSyncEventId: "sync-log-1",
      }),
      expect.objectContaining({
        ticketId: 501,
        ticketMaterialId: 12,
        todayAddedQuantity: -2,
        hours: -0.5,
        anomalyCode: "below_baseline_correction",
      }),
    ]);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

type TableRow = Record<string, unknown>;
type DbState = Record<string, TableRow[]>;

class MockSelectQuery {
  private readonly filters: Array<(row: TableRow) => boolean> = [];
  private readonly sorters: Array<{ column: string; ascending: boolean }> = [];
  private rowLimit: number | null = null;

  constructor(
    private readonly table: string,
    private readonly state: DbState,
  ) {}

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
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

  async single() {
    const rows = this.resolveRows();
    return { data: rows[0] ?? null, error: null };
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: { data: TableRow[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve({ data: this.resolveRows(), error: null }).then(onfulfilled, onrejected);
  }

  private resolveRows() {
    let rows = [...(this.state[this.table] ?? [])].filter((row) => this.filters.every((filter) => filter(row)));

    for (const sorter of [...this.sorters].reverse()) {
      rows.sort((left, right) => {
        const result = String(left[sorter.column] ?? "").localeCompare(String(right[sorter.column] ?? ""), "en");
        return sorter.ascending ? result : -result;
      });
    }

    if (this.rowLimit !== null) {
      rows = rows.slice(0, this.rowLimit);
    }

    return rows.map((row) => ({ ...row }));
  }
}

async function loadDashboardModule(state: DbState) {
  vi.resetModules();
  vi.doMock("server-only", () => ({}));
  vi.doMock("@/lib/supabase/server", () => ({
    createAdminClient: () => ({
      from(table: string) {
        return {
          select(_columns: string) {
            return new MockSelectQuery(table, state);
          },
        };
      },
    }),
  }));
  vi.doMock("@/lib/time", () => ({
    getCopenhagenDateString: () => "2026-04-14",
  }));

  return import("@/lib/data/dashboard");
}

afterEach(() => {
  vi.resetModules();
  vi.unmock("server-only");
  vi.unmock("@/lib/supabase/server");
  vi.unmock("@/lib/time");
});

describe("getDashboardAnomalySummary", () => {
  it("shows only unresolved missing rows and treats completed_with_warning as latest sync", async () => {
    const state: DbState = {
      daily_ticket_item_baselines: [
        {
          stat_date: "2026-04-14",
          mechanic_item_no: "MEK-ALICE",
          mechanic_id: "m-1",
          sync_state: "unresolved_missing",
          mechanic_item_mapping: { mechanic_name: "Alice", active: true },
        },
        {
          stat_date: "2026-04-14",
          mechanic_item_no: "MEK-ALICE",
          mechanic_id: "m-1",
          sync_state: "recovered",
          mechanic_item_mapping: { mechanic_name: "Alice", active: true },
        },
        {
          stat_date: "2026-04-14",
          mechanic_item_no: "MEK-ALICE",
          mechanic_id: "m-1",
          sync_state: "replaced",
          mechanic_item_mapping: { mechanic_name: "Alice", active: true },
        },
        {
          stat_date: "2026-04-14",
          mechanic_item_no: "MEK-INACTIVE",
          mechanic_id: "m-2",
          sync_state: "unresolved_missing",
          mechanic_item_mapping: { mechanic_name: "Inactive", active: false },
        },
        {
          stat_date: "2026-04-13",
          mechanic_item_no: "MEK-OLD",
          mechanic_id: "m-3",
          sync_state: "unresolved_missing",
          mechanic_item_mapping: { mechanic_name: "Old", active: true },
        },
      ],
      sync_event_log: [
        {
          sync_type: "sync",
          status: "completed",
          finished_at: "2026-04-14T10:00:00.000Z",
        },
        {
          sync_type: "sync",
          status: "completed_with_warning",
          finished_at: "2026-04-14T10:30:00.000Z",
        },
        {
          sync_type: "sync",
          status: "failed",
          finished_at: "2026-04-14T10:45:00.000Z",
        },
      ],
    };

    const { getDashboardAnomalySummary } = await loadDashboardModule(state);
    const summary = await getDashboardAnomalySummary();

    expect(summary).toEqual({
      hasIssues: true,
      totalMissingRows: 1,
      affectedMechanics: [{ mechanicName: "Alice", mechanicItemNo: "MEK-ALICE", missingRowCount: 1 }],
      latestSyncFinishedAt: "2026-04-14T10:30:00.000Z",
    });
  });
});

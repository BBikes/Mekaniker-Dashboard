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

  lt(column: string, value: unknown) {
    this.filters.push((row) => compareValues(row[column], value) < 0);
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
      | ((value: { data: TableRow[]; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve({ data: this.resolveRows(), error: null }).then(onfulfilled, onrejected);
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

  const leftValue = String(left);
  const rightValue = String(right);
  return leftValue.localeCompare(rightValue, "en");
}

function createMockSupabaseClient(state: DbState) {
  let generatedId = 0;

  function ensureTable(table: string) {
    if (!state[table]) {
      state[table] = [];
    }

    return state[table];
  }

  return {
    from(table: string) {
      const rows = ensureTable(table);

      return {
        select(_columns: string) {
          return new MockSelectQuery(table, state);
        },
        insert(payload: TableRow | TableRow[]) {
          const incoming = (Array.isArray(payload) ? payload : [payload]).map((row) => ({
            ...row,
            id: row.id ?? `${table}-${++generatedId}`,
          }));
          rows.push(...incoming);

          return {
            select(_columns: string) {
              return {
                async single() {
                  return { data: { ...incoming[0] }, error: null };
                },
              };
            },
          };
        },
        update(patch: TableRow) {
          return {
            async eq(column: string, value: unknown) {
              for (const row of rows) {
                if (row[column] === value) {
                  Object.assign(row, patch);
                }
              }

              return { error: null };
            },
          };
        },
        async upsert(payload: TableRow | TableRow[], options?: { onConflict?: string }) {
          const incoming = Array.isArray(payload) ? payload : [payload];
          const conflictColumns = options?.onConflict?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];

          for (const row of incoming) {
            const existing = conflictColumns.length
              ? rows.find((candidate) => conflictColumns.every((column) => candidate[column] === row[column]))
              : null;

            if (existing) {
              Object.assign(existing, row);
            } else {
              rows.push({ ...row });
            }
          }

          return { error: null };
        },
      };
    },
  };
}

type MockCustomersFirstClient = {
  listAllUpdatedTickets: ReturnType<typeof vi.fn>;
  listAllUpdatedTicketMaterials: ReturnType<typeof vi.fn>;
  listAllTicketMaterialsForTicket: ReturnType<typeof vi.fn>;
  listAllUpdatedPayments: ReturnType<typeof vi.fn>;
  getCykelPlusCustomerCount: ReturnType<typeof vi.fn>;
  getTicketById: ReturnType<typeof vi.fn>;
};

function createMockClient(overrides: Partial<MockCustomersFirstClient> = {}): MockCustomersFirstClient {
  return {
    listAllUpdatedTickets: vi.fn(async () => ({ normalizedItems: [], httpCalls: 0 })),
    listAllUpdatedTicketMaterials: vi.fn(async () => ({ normalizedItems: [], httpCalls: 0 })),
    listAllTicketMaterialsForTicket: vi.fn(async () => ({ normalizedItems: [], httpCalls: 0 })),
    listAllUpdatedPayments: vi.fn(async () => ({ normalizedItems: [], httpCalls: 0 })),
    getCykelPlusCustomerCount: vi.fn(async () => 0),
    getTicketById: vi.fn(async () => null),
    ...overrides,
  };
}

async function loadSyncModule(state: DbState, client: MockCustomersFirstClient) {
  vi.resetModules();
  vi.doMock("server-only", () => ({}));
  vi.doMock("@/lib/supabase/server", () => ({
    createAdminClient: () => createMockSupabaseClient(state),
  }));
  vi.doMock("@/lib/c1st/client", () => ({
    CustomersFirstClient: vi.fn(() => client),
  }));
  vi.doMock("@/lib/env", () => ({
    getServerConfig: () => ({
      cykelPlusTag: "CykelPlus",
    }),
  }));
  vi.doMock("@/lib/targets", () => ({
    getDailyTargetHoursForDate: async () => 8,
  }));
  vi.doMock("@/lib/time", () => ({
    getCopenhagenDateString: () => "2026-04-14",
    toIsoTimestamp: () => "2026-04-14T10:20:00.000Z",
  }));

  return import("@/lib/sync/run-phase-one-sync");
}

afterEach(() => {
  vi.resetModules();
  vi.unmock("server-only");
  vi.unmock("@/lib/supabase/server");
  vi.unmock("@/lib/c1st/client");
  vi.unmock("@/lib/env");
  vi.unmock("@/lib/targets");
  vi.unmock("@/lib/time");
});

describe("runPhaseOneSync", () => {
  it("uses material delta discovery with overlap and updates today's quarters and hours", async () => {
    const state: DbState = {
      mechanic_item_mapping: [
        {
          id: "m-1",
          mechanic_name: "Alice",
          mechanic_item_no: "MEK-ALICE",
          display_order: 0,
          active: true,
        },
      ],
      daily_ticket_item_baselines: [
        {
          stat_date: "2026-04-14",
          ticket_id: 500,
          mechanic_item_no: "MEK-ALICE",
          mechanic_id: "m-1",
          baseline_quantity: 4,
          current_quantity: 4,
          source_payment_id: null,
          source_amountpaid: null,
          source_updated_at: "2026-04-14T10:00:00.000Z",
          ticket_material_id: 11,
          ticket_type: "repair",
          last_seen_at: "2026-04-14T10:00:00.000Z",
        },
      ],
      daily_mechanic_totals: [],
      sync_event_log: [
        {
          id: "previous-sync",
          sync_type: "sync",
          status: "completed",
          finished_at: "2026-04-14T10:15:00.000Z",
        },
      ],
      ticket_type_cache: [],
      daily_payment_summary: [],
      cykelplus_snapshots: [],
    };

    const material = {
      ticketMaterialId: 11,
      ticketId: 500,
      productNo: "MEK-ALICE",
      title: "Mechanic work",
      amount: 8,
      totalInclVat: 400,
      sourceDate: "2026-04-14",
      updatedAt: "2026-04-14T10:16:00.000Z",
      paymentId: null,
      amountPaid: null,
      raw: {},
    };

    const client = createMockClient({
      listAllUpdatedTicketMaterials: vi.fn(async () => ({ normalizedItems: [material], httpCalls: 1 })),
      listAllTicketMaterialsForTicket: vi.fn(async () => ({ normalizedItems: [material], httpCalls: 1 })),
    });

    const { runPhaseOneSync } = await loadSyncModule(state, client);
    const result = await runPhaseOneSync("sync");

    expect(client.listAllUpdatedTicketMaterials).toHaveBeenCalledWith("2026-04-14T10:13:00.000Z");
    expect(client.listAllTicketMaterialsForTicket).toHaveBeenCalledWith(500);
    expect(result.httpCalls).toBe(2);

    expect(state.daily_ticket_item_baselines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stat_date: "2026-04-14",
          ticket_material_id: 11,
          current_quantity: 8,
          today_added_quantity: 4,
          today_added_hours: 1,
          ticket_type: "repair",
        }),
      ]),
    );

    expect(state.daily_mechanic_totals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stat_date: "2026-04-14",
          mechanic_id: "m-1",
          quarters_total: 4,
          hours_total: 1,
          target_hours: 8,
          variance_hours: -7,
        }),
      ]),
    );
  });

  it("classifies paid revenue via cache or baseline fallback and ignores open work cards", async () => {
    const state: DbState = {
      mechanic_item_mapping: [
        {
          id: "m-1",
          mechanic_name: "Alice",
          mechanic_item_no: "MEK-ALICE",
          display_order: 0,
          active: true,
        },
      ],
      daily_ticket_item_baselines: [
        {
          stat_date: "2026-04-13",
          ticket_id: 700,
          mechanic_item_no: "MEK-ALICE",
          mechanic_id: "m-1",
          baseline_quantity: 0,
          current_quantity: 4,
          source_payment_id: null,
          source_amountpaid: null,
          source_updated_at: "2026-04-13T12:00:00.000Z",
          ticket_material_id: 77,
          ticket_type: "repair",
          last_seen_at: "2026-04-13T12:00:00.000Z",
        },
        {
          stat_date: "2026-04-14",
          ticket_id: 999,
          mechanic_item_no: "MEK-ALICE",
          mechanic_id: "m-1",
          baseline_quantity: 0,
          current_quantity: 4,
          source_payment_id: null,
          source_amountpaid: null,
          source_updated_at: "2026-04-14T09:00:00.000Z",
          ticket_material_id: 88,
          ticket_type: "repair",
          last_seen_at: "2026-04-14T09:00:00.000Z",
        },
      ],
      daily_mechanic_totals: [],
      sync_event_log: [
        {
          id: "previous-sync",
          sync_type: "sync",
          status: "completed",
          finished_at: "2026-04-14T10:15:00.000Z",
        },
      ],
      ticket_type_cache: [{ ticket_id: 701, ticket_type: "repair" }],
      daily_payment_summary: [],
      cykelplus_snapshots: [],
    };

    const client = createMockClient({
      listAllUpdatedPayments: vi.fn(async () => ({
        normalizedItems: [
          {
            paymentId: 90,
            paymentDate: "2026-04-14",
            totalSum: 1000,
            taskIds: [700],
            articles: [
              { productNo: "MEK-ALICE", quantity: 1, totalInclVat: 300 },
              { productNo: "PART-1", quantity: 1, totalInclVat: 700 },
            ],
            raw: {},
          },
          {
            paymentId: 91,
            paymentDate: "2026-04-14",
            totalSum: 500,
            taskIds: [701],
            articles: [{ productNo: "PART-2", quantity: 1, totalInclVat: 500 }],
            raw: {},
          },
        ],
        httpCalls: 1,
      })),
      getCykelPlusCustomerCount: vi.fn(async () => 12),
    });

    const { runPhaseOneSync } = await loadSyncModule(state, client);
    await runPhaseOneSync("sync");

    expect(state.daily_payment_summary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payment_id: 90,
          payment_date: "2026-04-14",
          mechanic_total_incl_vat: 300,
          ticket_total_incl_vat: 1000,
          is_repair: true,
        }),
        expect.objectContaining({
          payment_id: 91,
          payment_date: "2026-04-14",
          mechanic_total_incl_vat: 0,
          ticket_total_incl_vat: 500,
          is_repair: true,
        }),
      ]),
    );
    expect(state.daily_payment_summary).toHaveLength(2);
    expect(state.cykelplus_snapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          snapshot_date: "2026-04-14",
          customer_count: 12,
        }),
      ]),
    );
  });

  it("bootstraps a 7 day payment backfill when summary is empty", async () => {
    const state: DbState = {
      mechanic_item_mapping: [
        {
          id: "m-1",
          mechanic_name: "Alice",
          mechanic_item_no: "MEK-ALICE",
          display_order: 0,
          active: true,
        },
      ],
      daily_ticket_item_baselines: [],
      daily_mechanic_totals: [],
      sync_event_log: [
        {
          id: "previous-sync",
          sync_type: "sync",
          status: "completed",
          finished_at: "2026-04-14T20:15:00.000Z",
        },
      ],
      ticket_type_cache: [],
      daily_payment_summary: [],
      cykelplus_snapshots: [],
    };

    const client = createMockClient({
      listAllUpdatedPayments: vi.fn(async () => ({
        normalizedItems: [
          {
            paymentId: 500,
            paymentDate: "2026-04-14",
            totalSum: 450,
            taskIds: [],
            articles: [{ productNo: "MEK-ALICE", quantity: 1, totalInclVat: 450 }],
            raw: {},
          },
        ],
        httpCalls: 1,
      })),
    });

    const { runPhaseOneSync } = await loadSyncModule(state, client);
    const result = await runPhaseOneSync("sync");

    expect(client.listAllUpdatedPayments).toHaveBeenCalledWith("2026-04-08 00:00:00");
    expect(result.payment).toEqual(
      expect.objectContaining({
        paymentsSeen: 1,
        paymentsUpserted: 1,
        paymentUpdatedAfter: "2026-04-08 00:00:00",
        paymentBackfillWindowDays: 7,
      }),
    );
    expect(state.daily_payment_summary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payment_id: 500,
          payment_date: "2026-04-14",
          mechanic_total_incl_vat: 450,
          ticket_total_incl_vat: 450,
        }),
      ]),
    );
  });

  it("uses direct ticket lookup as the final repair fallback and seeds ticket_type_cache", async () => {
    const state: DbState = {
      mechanic_item_mapping: [
        {
          id: "m-1",
          mechanic_name: "Alice",
          mechanic_item_no: "MEK-ALICE",
          display_order: 0,
          active: true,
        },
      ],
      daily_ticket_item_baselines: [],
      daily_mechanic_totals: [],
      sync_event_log: [],
      ticket_type_cache: [],
      daily_payment_summary: [],
      cykelplus_snapshots: [],
    };

    const client = createMockClient({
      listAllUpdatedPayments: vi.fn(async () => ({
        normalizedItems: [
          {
            paymentId: 610,
            paymentDate: "2026-04-14",
            totalSum: 900,
            taskIds: [8408718],
            articles: [
              { productNo: "MEK-ALICE", quantity: 1, totalInclVat: 300 },
              { productNo: "PART-1", quantity: 1, totalInclVat: 600 },
            ],
            raw: {},
          },
        ],
        httpCalls: 1,
      })),
      getTicketById: vi.fn(async (ticketId: number) => ({
        ticketId,
        ticketType: "repair",
        updatedAt: "2026-04-14T09:00:00.000Z",
        createdAt: "2026-04-14T08:00:00.000Z",
        raw: {},
      })),
    });

    const { runPhaseOneSync } = await loadSyncModule(state, client);
    await runPhaseOneSync("sync");

    expect(client.getTicketById).toHaveBeenCalledWith(8408718);
    expect(state.daily_payment_summary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payment_id: 610,
          is_repair: true,
        }),
      ]),
    );
    expect(state.ticket_type_cache).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ticket_id: 8408718,
          ticket_type: "repair",
        }),
      ]),
    );
  });

  it("keeps payments_backfill idempotent on payment_id", async () => {
    const state: DbState = {
      mechanic_item_mapping: [
        {
          id: "m-1",
          mechanic_name: "Alice",
          mechanic_item_no: "MEK-ALICE",
          display_order: 0,
          active: true,
        },
      ],
      daily_ticket_item_baselines: [],
      daily_mechanic_totals: [],
      sync_event_log: [],
      ticket_type_cache: [],
      daily_payment_summary: [],
      cykelplus_snapshots: [],
    };

    const client = createMockClient({
      listAllUpdatedPayments: vi.fn(async () => ({
        normalizedItems: [
          {
            paymentId: 700,
            paymentDate: "2026-04-14",
            totalSum: 300,
            taskIds: [],
            articles: [{ productNo: "MEK-ALICE", quantity: 1, totalInclVat: 300 }],
            raw: {},
          },
        ],
        httpCalls: 1,
      })),
    });

    const { runPhaseOneSync } = await loadSyncModule(state, client);
    await runPhaseOneSync("payments_backfill");
    await runPhaseOneSync("payments_backfill");

    expect(client.listAllUpdatedTickets).not.toHaveBeenCalled();
    expect(client.getCykelPlusCustomerCount).not.toHaveBeenCalled();
    expect(state.daily_payment_summary).toHaveLength(1);
    expect(state.daily_payment_summary[0]).toEqual(
      expect.objectContaining({
        payment_id: 700,
      }),
    );
  });

  it("surfaces payment errors as sync warnings in sync_event_log", async () => {
    const state: DbState = {
      mechanic_item_mapping: [
        {
          id: "m-1",
          mechanic_name: "Alice",
          mechanic_item_no: "MEK-ALICE",
          display_order: 0,
          active: true,
        },
      ],
      daily_ticket_item_baselines: [],
      daily_mechanic_totals: [],
      sync_event_log: [],
      ticket_type_cache: [],
      daily_payment_summary: [],
      cykelplus_snapshots: [],
    };

    const client = createMockClient({
      listAllUpdatedPayments: vi.fn(async () => {
        throw new Error("payment exploded");
      }),
    });

    const { runPhaseOneSync } = await loadSyncModule(state, client);
    const result = await runPhaseOneSync("sync");

    expect(result.payment).toEqual(
      expect.objectContaining({
        paymentError: expect.stringContaining("payment exploded"),
      }),
    );

    const syncLog = state.sync_event_log.find((row) => row.id === result.syncLogId);
    expect(syncLog).toEqual(
      expect.objectContaining({
        status: "completed_with_warning",
        message: "sync completed with payment warning",
      }),
    );
    expect(syncLog?.details_json).toEqual(
      expect.objectContaining({
        payment_error: expect.stringContaining("payment exploded"),
        payment_backfill_window_days: 7,
      }),
    );
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

type MockResponse = {
  count?: number | null;
  data?: unknown[];
  error?: { message: string } | null;
};

class MockQuery {
  public readonly calls = {
    eq: [] as Array<[string, string | number]>,
    gte: [] as Array<[string, string]>,
    in: [] as Array<[string, string[]]>,
    is: [] as Array<[string, null]>,
    lte: [] as Array<[string, string]>,
    neq: [] as Array<[string, string | number]>,
    not: [] as Array<[string, string, null]>,
    or: [] as string[],
    order: [] as Array<[string, Record<string, unknown> | undefined]>,
    range: [] as Array<[number, number]>,
    select: [] as Array<[string, Record<string, unknown> | undefined]>,
  };

  constructor(
    public readonly table: string,
    private readonly response: MockResponse,
  ) {}

  select(columns: string, options?: Record<string, unknown>) {
    this.calls.select.push([columns, options]);
    return this;
  }

  gte(column: string, value: string) {
    this.calls.gte.push([column, value]);
    return this;
  }

  lte(column: string, value: string) {
    this.calls.lte.push([column, value]);
    return this;
  }

  neq(column: string, value: string | number) {
    this.calls.neq.push([column, value]);
    return this;
  }

  eq(column: string, value: string | number) {
    this.calls.eq.push([column, value]);
    return this;
  }

  in(column: string, values: string[]) {
    this.calls.in.push([column, values]);
    return this;
  }

  not(column: string, operator: string, value: null) {
    this.calls.not.push([column, operator, value]);
    return this;
  }

  is(column: string, value: null) {
    this.calls.is.push([column, value]);
    return this;
  }

  or(filters: string) {
    this.calls.or.push(filters);
    return this;
  }

  order(column: string, options?: Record<string, unknown>) {
    this.calls.order.push([column, options]);
    return this;
  }

  range(from: number, to: number) {
    this.calls.range.push([from, to]);
    return this;
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: { count: number | null; data: unknown[]; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve({
      count: this.response.count ?? null,
      data: this.response.data ?? [],
      error: this.response.error ?? null,
    }).then(onfulfilled, onrejected);
  }
}

function createMockClient(responseConfig: Record<string, MockResponse | MockResponse[]>, queryLog: MockQuery[]) {
  const queues = new Map<string, MockResponse[]>(
    Object.entries(responseConfig).map(([table, config]) => [table, Array.isArray(config) ? [...config] : [config]]),
  );

  return {
    from(table: string) {
      const queue = queues.get(table);
      if (!queue || queue.length === 0) {
        throw new Error(`No mock response queued for table "${table}".`);
      }

      const query = new MockQuery(table, queue.shift() as MockResponse);
      queryLog.push(query);
      return query;
    },
  };
}

async function loadReportsModule(responseConfig: Record<string, MockResponse | MockResponse[]>) {
  const queryLog: MockQuery[] = [];
  vi.resetModules();
  vi.doMock("server-only", () => ({}));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => [],
    })),
  );
  vi.doMock("@/lib/supabase/server", () => ({
    createAdminClient: () => createMockClient(responseConfig, queryLog),
  }));

  const reports = await import("@/lib/data/reports");
  return { queryLog, reports };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.unmock("server-only");
  vi.unmock("@/lib/supabase/server");
});

describe("reports data helpers", () => {
  it("aggregates summary rows and re-sorts them in memory", async () => {
    const { reports } = await loadReportsModule({
      daily_mechanic_totals: {
        data: [
          {
            stat_date: "2026-04-01",
            mechanic_id: "m-b",
            quarters_total: 8,
            hours_total: 2,
            target_hours: 8,
            variance_hours: -6,
            mechanic: { mechanic_name: "Bente" },
          },
          {
            stat_date: "2026-04-02",
            mechanic_id: "m-b",
            quarters_total: 12,
            hours_total: 3,
            target_hours: 8,
            variance_hours: -5,
            mechanic: { mechanic_name: "Bente" },
          },
          {
            stat_date: "2026-04-01",
            mechanic_id: "m-a",
            quarters_total: 16,
            hours_total: 4,
            target_hours: 8,
            variance_hours: -4,
            mechanic: { mechanic_name: "Anders" },
          },
        ],
      },
      daily_ticket_item_baselines: {
        data: [
          { stat_date: "2026-04-01", mechanic_id: "m-a", ticket_id: 101 },
          { stat_date: "2026-04-01", mechanic_id: "m-b", ticket_id: 201 },
          { stat_date: "2026-04-02", mechanic_id: "m-b", ticket_id: 202 },
        ],
      },
    });

    const byHours = await reports.getAdminSummary({
      fromDate: "2026-04-01",
      toDate: "2026-04-30",
      periodMode: "daily",
      sort: "hours",
      dir: "desc",
    });

    expect(byHours.map((row) => [row.mechanicName, row.hours, row.tickets, row.workdays])).toEqual([
      ["Bente", 5, 2, 2],
      ["Anders", 4, 1, 1],
    ]);

    const byMechanic = await reports.getAdminSummary({
      fromDate: "2026-04-01",
      toDate: "2026-04-30",
      periodMode: "daily",
      sort: "mechanic",
      dir: "asc",
    });

    expect(byMechanic.map((row) => row.mechanicName)).toEqual(["Anders", "Bente"]);
  });

  it("applies the detailed paid filter at query level", async () => {
    const { queryLog, reports } = await loadReportsModule({
      daily_ticket_item_baselines: {
        count: 1,
        data: [
          {
            mechanic_id: "m-a",
            stat_date: "2026-04-02",
            ticket_id: 1001,
            ticket_material_id: 77,
            mechanic_item_no: "MATHIAS15",
            baseline_quantity: 4,
            current_quantity: 8,
            today_added_quantity: 4,
            today_added_hours: 1,
            source_payment_id: 44,
            source_amountpaid: 500,
            source_updated_at: "2026-04-02T08:15:00Z",
            anomaly_code: null,
            mechanic: { mechanic_name: "Anders" },
          },
        ],
      },
    });

    await reports.getDetailedPage({
      fromDate: "2026-04-01",
      toDate: "2026-04-30",
      periodMode: "daily",
      status: "paid",
      page: 1,
      pageSize: 25,
    });

    const baselinesQuery = queryLog.find((query) => query.table === "daily_ticket_item_baselines");
    expect(baselinesQuery?.calls.not).toContainEqual(["source_payment_id", "is", null]);
  });

  it("uses page and pageSize to calculate the Supabase range window", async () => {
    const { queryLog, reports } = await loadReportsModule({
      daily_ticket_item_baselines: {
        count: 81,
        data: [
          {
            mechanic_id: "m-a",
            stat_date: "2026-04-03",
            ticket_id: 2001,
            ticket_material_id: 88,
            mechanic_item_no: "MEK-2001",
            baseline_quantity: 0,
            current_quantity: 4,
            today_added_quantity: 4,
            today_added_hours: 1,
            source_payment_id: null,
            source_amountpaid: null,
            source_updated_at: "2026-04-03T10:00:00Z",
            anomaly_code: null,
            mechanic: { mechanic_name: "Bente" },
          },
        ],
      },
    });

    const page = await reports.getDetailedPage({
      fromDate: "2026-04-01",
      toDate: "2026-04-30",
      periodMode: "daily",
      page: 2,
      pageSize: 25,
    });

    const baselinesQuery = queryLog.find((query) => query.table === "daily_ticket_item_baselines");
    expect(page.total).toBe(81);
    expect(baselinesQuery?.calls.range).toEqual([[25, 49]]);
  });

  it("builds a calendar-year monthly overview with target and average quarters", async () => {
    const { reports } = await loadReportsModule({
      daily_mechanic_totals: {
        data: [
          {
            stat_date: "2026-01-05",
            mechanic_id: "m-a",
            quarters_total: 24,
            hours_total: 6,
            target_hours: 7.5,
            variance_hours: -1.5,
            mechanic: { mechanic_name: "Anders" },
          },
          {
            stat_date: "2026-01-06",
            mechanic_id: "m-b",
            quarters_total: 28,
            hours_total: 7,
            target_hours: 7.5,
            variance_hours: -0.5,
            mechanic: { mechanic_name: "Bente" },
          },
        ],
      },
      daily_ticket_item_baselines: {
        data: [],
      },
      mechanic_item_mapping: {
        data: [
          { id: "m-a", mechanic_name: "Anders" },
          { id: "m-b", mechanic_name: "Bente" },
        ],
      },
    });

    const rows = await reports.getCalendarYearOverview({}, 2026);
    const january = rows.find((row) => row.monthKey === "2026-01");
    const february = rows.find((row) => row.monthKey === "2026-02");

    expect(rows).toHaveLength(12);
    expect(january).toMatchObject({
      quarters: 52,
      hours: 13,
      targetHours: 325,
      varianceHours: -312,
      fulfillmentPct: 13 / 325,
      tickets: 0,
      avgHoursPerDay: 6.5,
      avgHoursPerTicket: 0,
    });
    expect(february).toMatchObject({
      quarters: 0,
      hours: 0,
      targetHours: 296,
      varianceHours: -296,
      fulfillmentPct: 0,
      tickets: 0,
      avgHoursPerDay: 0,
      avgHoursPerTicket: 0,
    });
  });
});

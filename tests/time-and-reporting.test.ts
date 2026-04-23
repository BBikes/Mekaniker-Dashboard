import { describe, expect, it, vi } from "vitest";

import { addDays, countWeekdaysBetween, getMonthKey, getStartOfMonth, getStartOfWeek, getWeekKey } from "@/lib/time";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => {
    throw new Error("createAdminClient should not be used in time helper tests.");
  },
}));

describe("time helpers", () => {
  it("builds stable ISO week keys", () => {
    expect(getWeekKey("2026-01-01")).toBe("2026-W01");
    expect(getWeekKey("2026-04-04")).toBe("2026-W14");
  });

  it("builds month keys", () => {
    expect(getMonthKey("2026-04-04")).toBe("2026-04");
  });

  it("builds stable period boundaries", () => {
    expect(addDays("2026-04-09", -7)).toBe("2026-04-02");
    expect(getStartOfWeek("2026-04-09")).toBe("2026-04-06");
    expect(getStartOfMonth("2026-04-09")).toBe("2026-04-01");
  });

  it("counts weekdays across a date range", () => {
    expect(countWeekdaysBetween("2026-04-06", "2026-04-12")).toBe(5);
    expect(countWeekdaysBetween("2026-04-11", "2026-04-12")).toBe(0);
  });

  it("calculates factual target hours with Friday and Danish holiday rules", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => [{ date: "2026-04-03" }],
      })),
    );

    const { getDailyTargetHoursForDate, getTargetHoursBetween } = await import("@/lib/targets");

    expect(await getDailyTargetHoursForDate("2026-04-02")).toBe(7.5);
    expect(await getDailyTargetHoursForDate("2026-04-03")).toBe(0);
    expect(await getDailyTargetHoursForDate("2026-04-10")).toBe(7);
    expect(await getDailyTargetHoursForDate("2026-04-11")).toBe(0);
    expect(await getTargetHoursBetween("2026-04-02", "2026-04-10")).toBe(44.5);

    vi.unstubAllGlobals();
  });
});

describe("dashboard windows", () => {
  it("resolves the configured dashboard periods", async () => {
    const { getDashboardWindow } = await import("@/lib/data/dashboard");

    // "today" board shows yesterday's data
    expect(getDashboardWindow("today", "2026-04-09")).toMatchObject({
      fromDate: "2026-04-08",
      toDate: "2026-04-08",
    });

    expect(getDashboardWindow("last_week", "2026-04-09")).toMatchObject({
      fromDate: "2026-04-02",
      toDate: "2026-04-08",
    });

    // current_week: Monday to yesterday
    expect(getDashboardWindow("current_week", "2026-04-09")).toMatchObject({
      fromDate: "2026-04-06",
      toDate: "2026-04-08",
    });

    // current_month: 1st of month to yesterday (same as current_week, so only completed days are shown)
    expect(getDashboardWindow("current_month", "2026-04-09")).toMatchObject({
      fromDate: "2026-04-01",
      toDate: "2026-04-08",
    });
  });
});

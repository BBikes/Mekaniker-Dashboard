import { describe, expect, it } from "vitest";

import { getMonthKey, getWeekKey } from "@/lib/time";

describe("time helpers", () => {
  it("builds stable ISO week keys", () => {
    expect(getWeekKey("2026-01-01")).toBe("2026-W01");
    expect(getWeekKey("2026-04-04")).toBe("2026-W14");
  });

  it("builds month keys", () => {
    expect(getMonthKey("2026-04-04")).toBe("2026-04");
  });
});

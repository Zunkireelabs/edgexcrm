import { describe, it, expect } from "vitest";
import { dueFilterToDateRange } from "./due-keywords";

describe("dueFilterToDateRange", () => {
  const todayISO = "2026-07-13";

  it("overdue: returns { to: yesterday }", () => {
    expect(dueFilterToDateRange("overdue", todayISO)).toEqual({ to: "2026-07-12" });
  });

  it("today: returns { from: today, to: today }", () => {
    expect(dueFilterToDateRange("today", todayISO)).toEqual({ from: todayISO, to: todayISO });
  });

  it("this_week: returns { from: today, to: today+7 }", () => {
    expect(dueFilterToDateRange("this_week", todayISO)).toEqual({ from: todayISO, to: "2026-07-20" });
  });

  it("none: returns { isNull: true }", () => {
    expect(dueFilterToDateRange("none", todayISO)).toEqual({ isNull: true });
  });

  it("__all__: returns null", () => {
    expect(dueFilterToDateRange("__all__", todayISO)).toBeNull();
  });

  it("undefined keyword: returns null", () => {
    expect(dueFilterToDateRange(undefined, todayISO)).toBeNull();
  });

  it("unknown keyword: returns null", () => {
    expect(dueFilterToDateRange("not-a-real-keyword", todayISO)).toBeNull();
  });

  it("overdue at a month boundary rolls back into the previous month", () => {
    expect(dueFilterToDateRange("overdue", "2026-08-01")).toEqual({ to: "2026-07-31" });
  });

  it("overdue at a year boundary rolls back into the previous year", () => {
    expect(dueFilterToDateRange("overdue", "2026-01-01")).toEqual({ to: "2025-12-31" });
  });

  it("this_week at a month boundary rolls forward into the next month", () => {
    expect(dueFilterToDateRange("this_week", "2026-07-28")).toEqual({ from: "2026-07-28", to: "2026-08-04" });
  });
});

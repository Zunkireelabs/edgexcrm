import { describe, it, expect } from "vitest";
import { resolveMatchedFilter, buildDateRangeFilter } from "./route";
import { dayBoundsInTz } from "@/lib/filters/compile";

describe("resolveMatchedFilter", () => {
  it('"new" maps to false', () => {
    expect(resolveMatchedFilter("new")).toBe(false);
  });

  it('"existing" maps to true', () => {
    expect(resolveMatchedFilter("existing")).toBe(true);
  });

  it("null (no param) maps to undefined — no filter applied", () => {
    expect(resolveMatchedFilter(null)).toBeUndefined();
  });

  it("an unrecognized value maps to undefined — no filter applied", () => {
    expect(resolveMatchedFilter("bogus")).toBeUndefined();
  });
});

describe("buildDateRangeFilter", () => {
  it("from=X & to=X in Asia/Kathmandu includes a submission created midday on X", () => {
    const tz = "Asia/Kathmandu";
    const { gte, lt } = buildDateRangeFilter("2026-08-29", "2026-08-29", tz);
    // A submission created at local noon on 2026-08-29 must fall inside [gte, lt).
    const middayLocal = new Date(dayBoundsInTz("2026-08-29", tz).start);
    middayLocal.setUTCHours(middayLocal.getUTCHours() + 12);
    const created = middayLocal.toISOString();

    expect(gte).toBeDefined();
    expect(lt).toBeDefined();
    expect(created >= gte!).toBe(true);
    expect(created < lt!).toBe(true);
  });

  it("to is an exclusive upper bound at the NEXT day's local midnight, not <= the given date", () => {
    const tz = "Asia/Kathmandu";
    const { lt } = buildDateRangeFilter(null, "2026-08-29", tz);
    // A submission created at local midnight on 2026-08-30 (the day AFTER `to`)
    // must be excluded — i.e. NOT < lt.
    const nextDayLocalMidnight = dayBoundsInTz("2026-08-30", tz).start;
    expect(nextDayLocalMidnight < lt!).toBe(false);
    // But the last instant of 2026-08-29 itself must be included.
    const endOf29 = dayBoundsInTz("2026-08-29", tz).end;
    expect(endOf29 <= lt!).toBe(true);
  });

  it("omitting from/to omits the corresponding bound entirely", () => {
    expect(buildDateRangeFilter(null, null, "UTC")).toEqual({});
    expect(buildDateRangeFilter("2026-08-29", null, "UTC").lt).toBeUndefined();
    expect(buildDateRangeFilter(null, "2026-08-29", "UTC").gte).toBeUndefined();
  });

  it("respects DST-style offset differences between timezones for the same date string", () => {
    const utc = buildDateRangeFilter("2026-08-29", "2026-08-29", "UTC");
    const kathmandu = buildDateRangeFilter("2026-08-29", "2026-08-29", "Asia/Kathmandu");
    expect(utc.gte).not.toBe(kathmandu.gte);
  });
});

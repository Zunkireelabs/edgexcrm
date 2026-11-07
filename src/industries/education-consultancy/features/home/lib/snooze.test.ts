import { describe, expect, it } from "vitest";
import { isValidItemKey, snoozeUntilTomorrow } from "./snooze";

describe("snoozeUntilTomorrow", () => {
  it("is the next local midnight in the tenant zone (Kathmandu, UTC+5:45)", () => {
    expect(snoozeUntilTomorrow(new Date("2026-11-09T04:15:00.000Z"), "Asia/Kathmandu").toISOString()).toBe("2026-11-09T18:15:00.000Z");
  });
  it("differs from UTC for the same instant", () => {
    expect(snoozeUntilTomorrow(new Date("2026-11-09T04:15:00.000Z"), "UTC").toISOString()).toBe("2026-11-10T00:00:00.000Z");
  });
});

describe("isValidItemKey", () => {
  it("accepts rule keys and rejects junk", () => {
    expect(isValidItemKey("new_uncalled:3f2b8c1e-0000-4000-8000-000000000001")).toBe(true);
    expect(isValidItemKey("going_quiet:all")).toBe(true);
    expect(isValidItemKey("x")).toBe(false);
    expect(isValidItemKey("a:b c")).toBe(false);
    expect(isValidItemKey(5)).toBe(false);
  });
});

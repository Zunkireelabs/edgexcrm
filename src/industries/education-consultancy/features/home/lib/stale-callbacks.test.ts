import { describe, expect, it } from "vitest";
import { isStaleCallback } from "./rules/callbacks";
import { CLEAR_MAX, clearCountMatches, staleCutoff } from "./stale-callbacks";
import { staleCallbacksRow } from "./needs-you";

const now = new Date("2026-11-09T04:15:00.000Z"); // Mon 9 Nov 10:00 Kathmandu

describe("staleCutoff (tenant-local, 14 days)", () => {
  it("is local midnight of today - 14: Kathmandu 26 Oct 00:00 = 25 Oct 18:15Z; UTC 26 Oct 00:00Z", () => {
    expect(staleCutoff(now, "Asia/Kathmandu").toISOString()).toBe("2026-10-25T18:15:00.000Z");
    expect(staleCutoff(now, "UTC").toISOString()).toBe("2026-10-26T00:00:00.000Z");
  });
  it("agrees with the per-lead rule at the 14 / 15 day edge", () => {
    const cut = staleCutoff(now, "Asia/Kathmandu").getTime();
    const ctx = { now, tz: "Asia/Kathmandu" };
    for (const due of ["2026-10-25T18:14:00.000Z", "2026-10-25T18:16:00.000Z", "2026-10-20T00:00:00.000Z", "2026-10-30T00:00:00.000Z"]) {
      expect(Date.parse(due) < cut).toBe(isStaleCallback(due, ctx));
    }
  });
});

describe("clearCountMatches (client confirms only a count)", () => {
  it("exact or within 10% → ok", () => {
    expect(clearCountMatches(100, 100)).toBe(true);
    expect(clearCountMatches(100, 110)).toBe(true);
    expect(clearCountMatches(100, 90)).toBe(true);
  });
  it("more than 10% away → must re-confirm", () => {
    expect(clearCountMatches(100, 111)).toBe(false);
    expect(clearCountMatches(100, 80)).toBe(false);
    expect(clearCountMatches(100, 0)).toBe(false);
  });
  it("a shown zero only matches zero", () => {
    expect(clearCountMatches(0, 0)).toBe(true);
    expect(clearCountMatches(0, 3)).toBe(false);
  });
  it("cap per call is 1,000", () => expect(CLEAR_MAX).toBe(1000));
});

describe("staleCallbacksRow", () => {
  it("one item with 'Clear them'; nothing when there are none", () => {
    const r = staleCallbacksRow(572)!;
    expect(r.title).toBe("572 call-back reminders are over 2 weeks old");
    expect(r.actions).toEqual([{ type: "clear_stale", label: "Clear them", count: 572 }]);
    expect(staleCallbacksRow(1)!.title).toBe("1 call-back reminder is over 2 weeks old");
    expect(staleCallbacksRow(0)).toBeNull();
  });
});

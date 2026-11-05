import { describe, it, expect } from "vitest";
import { fullSpan, previousWindow, resolvePulseWindow, usualWindows, windowLengthMs } from "./window";

// America/Los_Angeles on purpose: the dev box is Asia/Kathmandu (UTC+5:45), which hides day-boundary bugs.
const LA = "America/Los_Angeles";
const NOW = new Date("2026-11-05T03:30:00Z"); // 2026-11-04 19:30 in LA (PST, UTC-8)

describe("resolvePulseWindow", () => {
  it("24h is rolling", () => {
    const w = resolvePulseWindow("24h", NOW, LA)!;
    expect(w.to).toEqual(NOW);
    expect(windowLengthMs(w)).toBe(24 * 3600_000);
  });

  it("7d starts at LOCAL midnight 6 days before today, not UTC midnight", () => {
    const w = resolvePulseWindow("7d", NOW, LA)!;
    // local today = Nov 4 → start Oct 29 00:00 PDT/PST. Oct 29 is still PDT (UTC-7); DST ended Nov 1.
    expect(w.from.toISOString()).toBe("2026-10-29T07:00:00.000Z");
    expect(w.to).toEqual(NOW);
  });

  it("uses the tenant date, not the UTC date, when they differ", () => {
    // NOW is Nov 5 in UTC but still Nov 4 in LA.
    const w = resolvePulseWindow("30d", NOW, LA)!;
    expect(w.from.toISOString()).toBe("2026-10-06T07:00:00.000Z"); // Oct 6 00:00 PDT
  });

  it("custom is whole local days, [from, to+1day)", () => {
    const w = resolvePulseWindow("custom", NOW, LA, { from: "2026-11-01", to: "2026-11-02" })!;
    expect(w.from.toISOString()).toBe("2026-11-01T07:00:00.000Z"); // Nov 1 00:00 PDT
    expect(w.to.toISOString()).toBe("2026-11-03T08:00:00.000Z"); // Nov 3 00:00 PST (DST ended)
  });

  it("rejects bad input", () => {
    expect(resolvePulseWindow("custom", NOW, LA)).toBeNull();
    expect(resolvePulseWindow("custom", NOW, LA, { from: "2026-11-02", to: "2026-11-01" })).toBeNull();
    expect(resolvePulseWindow("custom", NOW, LA, { from: "nope", to: "2026-11-01" })).toBeNull();
    expect(resolvePulseWindow("90d", NOW, LA)).toBeNull();
  });
});

describe("previous / usual windows", () => {
  const w = resolvePulseWindow("7d", NOW, LA)!;
  it("previous is equal length and ends where the window starts", () => {
    const p = previousWindow(w);
    expect(p.to).toEqual(w.from);
    expect(windowLengthMs(p)).toBe(windowLengthMs(w));
  });
  it("usual is 4 contiguous equal-length windows, most recent first", () => {
    const u = usualWindows(w);
    expect(u).toHaveLength(4);
    expect(u[0]).toEqual(previousWindow(w));
    for (let i = 1; i < 4; i++) expect(u[i].to).toEqual(u[i - 1].from);
    u.forEach((x) => expect(windowLengthMs(x)).toBe(windowLengthMs(w)));
  });
  it("fullSpan covers all five windows", () => {
    const s = fullSpan(w);
    expect(s.to).toEqual(w.to);
    expect(s.to.getTime() - s.from.getTime()).toBe(5 * windowLengthMs(w));
  });
});

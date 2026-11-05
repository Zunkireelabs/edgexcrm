import { describe, it, expect } from "vitest";
import { fullSpan, periodSpans, previousWindow, resolvePulseWindow, usualWindows, windowLengthMs } from "./window";

// America/Los_Angeles on purpose: the dev box is Asia/Kathmandu (UTC+5:45), which hides day-boundary bugs.
const LA = "America/Los_Angeles";
const NOW = new Date("2026-11-05T03:30:00Z"); // 2026-11-04 19:30 in LA (PST, UTC-8)

describe("resolvePulseWindow", () => {
  it("today is since LOCAL midnight in the tenant tz, not a rolling 24h", () => {
    const w = resolvePulseWindow("today", NOW, LA)!;
    expect(w.key).toBe("today");
    expect(w.from.toISOString()).toBe("2026-11-04T08:00:00.000Z"); // Nov 4 00:00 PST
    expect(w.to).toEqual(NOW);
    expect(windowLengthMs(w)).toBe(19.5 * 3600_000);
  });
  it('"24h" is accepted as an alias of "today" (one release)', () => {
    expect(resolvePulseWindow("24h", NOW, LA)).toEqual(resolvePulseWindow("today", NOW, LA));
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

describe("Today — partial-day windows and aligned comparison spans", () => {
  const NPT = "Asia/Kathmandu"; // UTC+5:45, no DST
  const iso = (d: Date) => d.toISOString();

  it("00:05 Kathmandu: the window opened five minutes ago, at local midnight", () => {
    const now = new Date("2026-11-04T18:20:00Z"); // 2026-11-05 00:05 NPT
    const w = resolvePulseWindow("today", now, NPT)!;
    expect(iso(w.from)).toBe("2026-11-04T18:15:00.000Z");
    expect(w.to).toEqual(now);
    expect(windowLengthMs(w)).toBe(5 * 60_000);
    const sp = periodSpans(w, NPT);
    expect(iso(sp.previous.from)).toBe("2026-11-03T18:15:00.000Z"); // yesterday 00:00
    expect(iso(sp.previous.to)).toBe("2026-11-03T18:20:00.000Z"); // … 00:05
  });
  it("23:55 Kathmandu is still today, 23h55m elapsed; yesterday is cut at the same clock time", () => {
    const now = new Date("2026-11-05T18:10:00Z"); // 2026-11-05 23:55 NPT
    const w = resolvePulseWindow("today", now, NPT)!;
    expect(iso(w.from)).toBe("2026-11-04T18:15:00.000Z");
    expect(windowLengthMs(w)).toBe((23 * 60 + 55) * 60_000);
    const sp = periodSpans(w, NPT);
    expect(iso(sp.previous.from)).toBe("2026-11-03T18:15:00.000Z");
    expect(iso(sp.previous.to)).toBe("2026-11-04T18:10:00.000Z"); // yesterday 23:55
  });
  it("at exactly midnight the window is floored to one minute (never empty)", () => {
    const now = new Date("2026-11-04T18:15:00Z");
    const w = resolvePulseWindow("today", now, NPT)!;
    expect(windowLengthMs(w)).toBe(60_000);
  });
  it("the same-weekday ×4 usual spans land on the right dates, most recent first (Thu Nov 5 → Oct 29, 22, 15, 8)", () => {
    const w = resolvePulseWindow("today", new Date("2026-11-05T06:00:00Z"), NPT)!; // 11:45 NPT, a Thursday
    const sp = periodSpans(w, NPT);
    expect(sp.aligned).toBe(true);
    expect(sp.usual.map((u) => iso(u.from))).toEqual([
      "2026-10-28T18:15:00.000Z", "2026-10-21T18:15:00.000Z", "2026-10-14T18:15:00.000Z", "2026-10-07T18:15:00.000Z",
    ]); // local midnights of Oct 29, 22, 15, 8
    for (const u of sp.usual) expect(u.to.getTime() - u.from.getTime()).toBe(windowLengthMs(w));
    for (const u of sp.usual) expect(new Date(u.from.getTime() + 5.75 * 3600_000).getUTCDay()).toBe(4); // Thursday in NPT
  });
  it("a tenant in a different tz than the server (LA): local midnights, DST-aware", () => {
    const w = resolvePulseWindow("today", NOW, LA)!; // Nov 4, 19:30 PST
    const sp = periodSpans(w, LA);
    expect(iso(sp.previous.from)).toBe("2026-11-03T08:00:00.000Z"); // Nov 3 00:00 PST
    expect(sp.usual.map((u) => iso(u.from))).toEqual([
      "2026-10-28T07:00:00.000Z", "2026-10-21T07:00:00.000Z", "2026-10-14T07:00:00.000Z", "2026-10-07T07:00:00.000Z", // 00:00 PDT
    ]);
  });
  it("rolling windows keep contiguous comparison windows (not aligned)", () => {
    const w = resolvePulseWindow("7d", NOW, LA)!;
    const sp = periodSpans(w, LA);
    expect(sp.aligned).toBe(false);
    expect(sp.previous).toEqual(previousWindow(w));
    expect(sp.usual).toEqual(usualWindows(w));
  });
});

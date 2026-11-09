import { describe, expect, it } from "vitest";
import { impactRows, impactStatus, measuringSince, orcaDraftsRow } from "./impact";

const now = new Date("2026-12-10T00:00:00.000Z");
const raw = (fh: [number, number], cb: [number, number], dl: [number, number]) => ({
  first_hour: { called: fh[0], total: fh[1] },
  callbacks: { done: cb[0], total: cb[1] },
  deadlines: { missed: dl[0], total: dl[1] },
});

describe("impactStatus", () => {
  it("no launch date → unset (never zeros)", () => {
    expect(impactStatus(null, now)).toEqual({ kind: "unset" });
    expect(impactStatus("garbage", now)).toEqual({ kind: "unset" });
  });
  it("before 7 days after launch → 'Ready on <date>' (launch + 7 days), never numbers", () => {
    expect(impactStatus("2026-12-05T00:00:00.000Z", now)).toEqual({ kind: "measuring", since: "2026-12-05T00:00:00.000Z", readyOn: "2026-12-12T00:00:00.000Z" });
  });
  it("exactly 7 days after launch is ready, measuring since launch (afterDays = 7)", () => {
    const s = impactStatus("2026-12-03T00:00:00.000Z", now);
    expect(s.kind).toBe("ready");
    if (s.kind !== "ready") return;
    expect(s.after.from.toISOString()).toBe("2026-12-03T00:00:00.000Z");
    expect(s.afterDays).toBe(7);
  });
  it("between 7 and 21 days the after window starts at launch, not before it", () => {
    const s = impactStatus("2026-11-26T00:00:00.000Z", now);
    if (s.kind !== "ready") throw new Error("ready expected");
    expect(s.after.from.toISOString()).toBe("2026-11-26T00:00:00.000Z");
    expect(s.afterDays).toBe(14);
    expect(s.before.to.toISOString()).toBe("2026-11-26T00:00:00.000Z");
  });
  it("after 3 weeks → before = 4 weeks ending at launch, after = last 3 weeks", () => {
    const s = impactStatus("2026-11-01T00:00:00.000Z", now);
    expect(s.kind).toBe("ready");
    if (s.kind !== "ready") return;
    expect(s.before.from.toISOString()).toBe("2026-10-04T00:00:00.000Z");
    expect(s.before.to.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(s.after.from.toISOString()).toBe("2026-11-19T00:00:00.000Z");
    expect(s.after.to.toISOString()).toBe(now.toISOString());
    expect(s.afterDays).toBe(21);
  });
  it("exactly 21 days after launch is ready", () => {
    expect(impactStatus("2026-11-19T00:00:00.000Z", now).kind).toBe("ready");
  });
});

describe("impactRows", () => {
  it("rates with 'was', good when 5+ points better", () => {
    const rows = impactRows(raw([52, 100], [61, 100], [3, 10]), raw([71, 100], [84, 100], [0, 8]));
    expect(rows.map((r) => [r.value, r.was, r.tone])).toEqual([
      ["71%", "was 52%", "good"],
      ["84%", "was 61%", "good"],
      ["0", "was 3 in 4 weeks", "good"],
    ]);
  });
  it("worse is amber, within 5 points is neutral", () => {
    const rows = impactRows(raw([60, 100], [50, 100], [1, 5]), raw([40, 100], [52, 100], [3, 5]));
    expect(rows[0].tone).toBe("warn");
    expect(rows[1].tone).toBe("neutral");
    expect(rows[2].tone).toBe("warn");
  });
  it("deadlines compare per week (3 vs 4 weeks)", () => {
    // 3 in 3 weeks (1/wk) vs 4 in 4 weeks (1/wk) = equal
    expect(impactRows(raw([0, 0], [0, 0], [4, 9]), raw([0, 0], [0, 0], [3, 9]))[2].tone).toBe("neutral");
  });
  it("too few events → 'Not enough yet', never 100% of 1", () => {
    const rows = impactRows(raw([5, 10], [5, 10], [0, 0]), raw([1, 1], [0, 2], [0, 0]));
    expect(rows[0]).toMatchObject({ value: "Not enough yet", was: null });
    expect(rows[1]).toMatchObject({ value: "Not enough yet" });
    expect(rows[2]).toMatchObject({ value: "0", was: null });
  });
  it("no baseline → value without 'was'", () => {
    expect(impactRows(raw([0, 0], [0, 0], [0, 0]), raw([8, 10], [8, 10], [0, 3]))[0]).toMatchObject({ value: "80%", was: null, tone: "neutral" });
  });
});

describe("measuringSince", () => {
  it("formats in the tenant zone", () => {
    expect(measuringSince("2026-11-25T20:00:00.000Z", "Asia/Kathmandu")).toBe("26 Nov");
  });
});

describe("deadlines per week follow the real after-window length", () => {
  it("2 missed in 14 days (1/wk) vs 4 in 28 days (1/wk) is equal; the same 2 against a 21-day window would read better", () => {
    expect(impactRows(raw([0, 0], [0, 0], [4, 9]), raw([0, 0], [0, 0], [2, 9]), 14)[2].tone).toBe("neutral");
    expect(impactRows(raw([0, 0], [0, 0], [4, 9]), raw([0, 0], [0, 0], [2, 9]), 21)[2].tone).toBe("good");
  });
});

describe("orcaDraftsRow: 'Orca drafts sent as written'", () => {
  it("64% as written, 28% edited, 8% thrown away (H5)", () => {
    expect(orcaDraftsRow({ sent: 16, edited: 7, discarded: 2 })).toEqual({ key: "orca_drafts", label: "Orca drafts sent as written", value: "64%", was: "28% edited · 8% thrown away", tone: "neutral" });
  });
  it("under 5 finished drafts is 'Not enough yet', never 100% of 1", () => {
    expect(orcaDraftsRow({ sent: 1, edited: 0, discarded: 0 })).toMatchObject({ value: "Not enough yet", was: null });
    expect(orcaDraftsRow({ sent: 0, edited: 0, discarded: 0 })).toMatchObject({ value: "Not enough yet" });
  });
});

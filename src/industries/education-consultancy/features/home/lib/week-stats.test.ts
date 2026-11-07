import { describe, expect, it } from "vitest";
import { countMetric, firstHourCounts, firstHourMetric, leaveText } from "./week-stats";

describe("countMetric (Pulse's compareToUsual)", () => {
  it("shows usual only when real (>= 5 and covered)", () => {
    expect(countMetric("calls", "Calls made", { current: 38, usual: 46.2, hasUsual: true }, null).note).toBe("usual 46");
    expect(countMetric("calls", "Calls made", { current: 3, usual: 2, hasUsual: true }, null).note).toBeNull();
    expect(countMetric("calls", "Calls made", { current: 38, usual: 46, hasUsual: false }, null).note).toBeNull();
  });
  it("names leave as the reason only when the count is down, amber not red", () => {
    const m = countMetric("calls", "Calls made", { current: 38, usual: 60, hasUsual: true }, "you were on leave Friday");
    expect(m.note).toBe("usual 60 · you were on leave Friday");
    expect(m.tone).toBe("warn");
    expect(countMetric("calls", "Calls made", { current: 60, usual: 46, hasUsual: true }, "you were on leave Friday").note).toBe("usual 46");
  });
});

describe("first hour", () => {
  it("counts leads called within 60 minutes of assignment, inside the window only", () => {
    const T = 1_000_000_000_000;
    const r = firstHourCounts(
      [{ id: "a", assignedAt: T }, { id: "b", assignedAt: T }, { id: "c", assignedAt: T - 99_999_999 }],
      new Map([["a", [T + 59 * 60_000]], ["b", [T + 61 * 60_000]]]),
      T - 1000,
      T + 1000,
    );
    expect(r).toEqual({ called: 1, total: 2 });
  });
  it("compares with the usual only with enough history", () => {
    expect(firstHourMetric({ current: { called: 5, total: 7 }, usual: { called: 4, total: 7 } }).note).toBe("better than your usual 4 of 7");
    expect(firstHourMetric({ current: { called: 5, total: 7 }, usual: { called: 1, total: 2 } }).note).toBeNull();
    expect(firstHourMetric({ current: { called: 0, total: 0 }, usual: null }).value).toBe("0 of 0");
  });
});

describe("leaveText", () => {
  it("names a single day or a range", () => {
    expect(leaveText(["2026-11-06"])).toBe("you were on leave Friday");
    expect(leaveText(["2026-11-12", "2026-11-13"])).toBe("you were on leave 12–13 Nov");
    expect(leaveText([])).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { compareToUsual, formatChange, shownUsual } from "./compare";

describe("compareToUsual — the one guard", () => {
  it("usual 0 / 1 / 4 → null (never '140×', never 'usual is 0')", () => {
    for (const u of [0, 1, 4, 4.9]) expect(compareToUsual(35, u)).toBeNull();
  });
  it("uncovered usual → null even when the number looks fine", () => expect(compareToUsual(35, 20, false)).toBeNull());
  it("normal case is unchanged", () => {
    expect(compareToUsual(15, 10)).toEqual({ pct: 50, ratio: 1.5 });
    expect(compareToUsual(2, 10)).toEqual({ pct: -80, ratio: 0.2 });
    expect(compareToUsual(5, 5)).toEqual({ pct: 0, ratio: 1 });
  });
  it("non-finite input → null", () => {
    expect(compareToUsual(NaN, 10)).toBeNull();
    expect(compareToUsual(5, null)).toBeNull();
  });
});

describe("the % always agrees with the printed (whole-number) usual", () => {
  it("18 against a raw usual of 5.5 prints usual 6 and +200%, never +227%", () => {
    expect(compareToUsual(18, 5.5)).toEqual({ pct: 200, ratio: 3 });
    expect(shownUsual(5.5)).toBe(6);
  });
  it("for any current/usual, pct recomputed from the printed usual matches", () => {
    for (const usual of [5, 5.4, 5.5, 6.6, 12.5, 28.4, 82.5]) for (const cur of [0, 3, 18, 104]) {
      const c = compareToUsual(cur, usual)!;
      expect(c.pct).toBe(Math.round(((cur - shownUsual(usual)) / shownUsual(usual)) * 100));
    }
  });
});

describe("formatChange — fits a 5-character slot", () => {
  it("percentages below +300%", () => {
    expect(formatChange({ pct: 50, ratio: 1.5 })).toBe("+50%");
    expect(formatChange({ pct: -100, ratio: 0 })).toBe("−100%");
    expect(formatChange({ pct: 0, ratio: 1 })).toBe("±0");
    expect(formatChange({ pct: 299, ratio: 3.99 })).toBe("+299%");
  });
  it("from +300% a multiplier", () => {
    expect(formatChange({ pct: 300, ratio: 4 })).toBe("4×");
    expect(formatChange({ pct: 242, ratio: 3.42 })).toBe("+242%");
    expect(formatChange({ pct: 340, ratio: 4.4 })).toBe("4.4×");
    expect(formatChange({ pct: 1100, ratio: 12 })).toBe("12×");
    expect(formatChange({ pct: 12700, ratio: 128 })).toBe("128×");
  });
  it("never longer than 5 characters", () => {
    for (const [cur, usual] of [[1, 5], [500, 5], [10000, 5], [0, 5], [9999, 7]] as const) {
      const t = formatChange(compareToUsual(cur, usual));
      expect(t!.length).toBeLessThanOrEqual(5);
    }
  });
  it("null in, null out", () => expect(formatChange(null)).toBeNull());
});

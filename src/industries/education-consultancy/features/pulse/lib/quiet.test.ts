import { describe, it, expect } from "vitest";
import { quietSinceDay } from "./quiet";

const d = (day: string, n: number) => ({ day, calls: n, notes: 0, moves: 0 });
// 2025-11-03 is a Monday
const week = (ns: number[]) => ns.map((n, i) => d(`2025-11-${String(3 + i).padStart(2, "0")}`, n));

describe("quietSinceDay", () => {
  it("is the first working day of the trailing quiet run", () => {
    expect(quietSinceDay(week([20, 22, 18, 2, 1, 0, 0]), 20)).toBe("2025-11-06"); // Thu
  });
  it("skips weekend days at the start of the run", () => {
    expect(quietSinceDay(week([20, 22, 18, 20, 19, 1, 0]), 20)).toBeNull(); // only Sat/Sun quiet → no working day
    expect(quietSinceDay(week([20, 22, 18, 20, 2, 1, 0]), 20)).toBe("2025-11-07"); // Fri
  });
  it("null with no clean stop (always quiet, never quiet, or a single day)", () => {
    expect(quietSinceDay(week([1, 1, 1, 1, 1, 1, 1]), 20)).toBeNull();
    expect(quietSinceDay(week([20, 20, 20, 20, 20, 20, 20]), 20)).toBeNull();
    expect(quietSinceDay(week([20, 20, 20, 20, 20, 20, 1]), 20)).toBeNull();
  });
  it("null without a usual", () => expect(quietSinceDay(week([5, 5, 5, 0, 0, 0, 0]), 0)).toBeNull());
});

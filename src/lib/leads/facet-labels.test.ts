import { describe, it, expect } from "vitest";
import { countSuffix, isOfferedByCount } from "./facet-labels";

describe("facet label helpers", () => {
  const counts = new Map([["a", 1234], ["b", 0]]);

  it("prints a locale-formatted count when known, including 0 for an absent key", () => {
    expect(countSuffix(counts, "a")).toBe(" (1,234)");
    expect(countSuffix(counts, "zzz")).toBe(" (0)");
  });

  it("prints NO number when counts are unknown — never a guessed 0", () => {
    expect(countSuffix(null, "a")).toBe("");
  });

  it("hides zero-count options only when counts are known", () => {
    expect(isOfferedByCount(counts, "a")).toBe(true);
    expect(isOfferedByCount(counts, "b")).toBe(false);
    expect(isOfferedByCount(counts, "b", true)).toBe(true); // currently-selected stays
  });

  it("offers every option when counts are unknown — hiding on an unknown count would drop real people", () => {
    expect(isOfferedByCount(null, "b")).toBe(true);
  });
});

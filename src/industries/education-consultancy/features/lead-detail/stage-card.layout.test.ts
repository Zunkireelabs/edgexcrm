import { describe, it, expect } from "vitest";
import { segmentGrid } from "./stage-card";

// Inner width of the stage card at a 320px column with a classic 12px scrollbar: 320 - 1 border - 12 scrollbar - 24 margins - 24 padding.
const INNER = 259;
const GAP = 2;

describe("segmentGrid", () => {
  const widthsFor = (names: string[], inner = INNER) => {
    const frs = names.map((n) => Math.max(n.length, 7));
    const total = frs.reduce((a, b) => a + b, 0);
    const usable = inner - GAP * (names.length - 1);
    return frs.map((f) => (usable * f) / total);
  };

  it("weights columns by label length, never a fixed px", () => {
    expect(segmentGrid(["Pre-qualified", "Qualified", "Prospects", "Applications"])).toBe("minmax(0, 13fr) minmax(0, 9fr) minmax(0, 9fr) minmax(0, 12fr)");
    expect(segmentGrid([])).toBe("minmax(0, 1fr)");
  });

  it("with a forced 12px scrollbar every 11px label still gets its natural width (~5.8px per char)", () => {
    const names = ["Pre-qualified", "Qualified", "Prospects", "Applications"];
    widthsFor(names).forEach((w, i) => expect(w).toBeGreaterThanOrEqual(names[i].length * 5.8));
  });
});

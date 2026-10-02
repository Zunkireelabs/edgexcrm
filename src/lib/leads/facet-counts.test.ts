import { describe, it, expect } from "vitest";
import { countFacetOptions } from "./facet-counts";

describe("countFacetOptions", () => {
  it("drops zero counts, sorts by count desc, and dedupes candidates", async () => {
    const counts: Record<string, number> = { a: 3, b: 0, c: 9 };
    const out = await countFacetOptions(["a", "b", "c", "a"], async (id) => ({ count: counts[id], error: null }));
    expect(out).toEqual([
      { name: "c", count: 9 },
      { name: "a", count: 3 },
    ]);
  });

  it("throws if any single count fails — never returns a half-answered facet", async () => {
    await expect(
      countFacetOptions(["a", "b"], async (id) => (id === "b" ? { count: null, error: { message: "boom" } } : { count: 1, error: null })),
    ).rejects.toThrow(/boom/);
  });

  it("never runs more than `concurrency` counts at once", async () => {
    let inFlight = 0;
    let peak = 0;
    await countFacetOptions(
      Array.from({ length: 20 }, (_, i) => `u${i}`),
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
        return { count: 1, error: null };
      },
      4,
    );
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("handles an empty candidate list", async () => {
    expect(await countFacetOptions([], async () => ({ count: 1, error: null }))).toEqual([]);
  });
});

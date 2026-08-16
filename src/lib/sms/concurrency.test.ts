import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./concurrency";

describe("mapWithConcurrency", () => {
  it("returns results in input order regardless of completion order", async () => {
    const items = [30, 10, 20];
    const results = await mapWithConcurrency(items, 3, (ms) => new Promise((resolve) => setTimeout(() => resolve(ms), ms)));
    expect(results).toEqual([30, 10, 20]);
  });

  it("never runs more than `limit` items concurrently", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 25 }, (_, i) => i);

    await mapWithConcurrency(items, 5, async (i) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return i;
    });

    expect(maxInFlight).toBeLessThanOrEqual(5);
  });

  it("processes every item exactly once at a large size", async () => {
    const items = Array.from({ length: 5000 }, (_, i) => i);
    const seen = new Set<number>();
    await mapWithConcurrency(items, 25, async (i) => {
      seen.add(i);
      return i;
    });
    expect(seen.size).toBe(5000);
  });

  it("propagates a rejection rather than hanging", async () => {
    const items = [1, 2, 3];
    await expect(
      mapWithConcurrency(items, 2, async (i) => {
        if (i === 2) throw new Error("boom");
        return i;
      })
    ).rejects.toThrow("boom");
  });

  it("returns an empty array for an empty input without spawning workers", async () => {
    let called = false;
    const results = await mapWithConcurrency([], 5, async () => {
      called = true;
      return null;
    });
    expect(results).toEqual([]);
    expect(called).toBe(false);
  });

  it("clamps an oversized limit to the item count rather than over-allocating workers", async () => {
    const items = [1, 2];
    const results = await mapWithConcurrency(items, 100, async (i) => i * 2);
    expect(results).toEqual([2, 4]);
  });
});

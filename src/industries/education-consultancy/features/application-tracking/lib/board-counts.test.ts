import { describe, it, expect, vi } from "vitest";
import { fetchAllPages, fetchBoardCounts } from "./board-counts";

describe("fetchAllPages", () => {
  it("pages past the 1000-row cap: 1000 + 1000 + 3 = 2003", async () => {
    const sizes = [1000, 1000, 3];
    const calls: [number, number][] = [];
    const rows = await fetchAllPages(async (from, to) => {
      calls.push([from, to]);
      return Array.from({ length: sizes[calls.length - 1] }, (_, i) => ({ id: from + i }));
    });
    expect(rows).toHaveLength(2003);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("stops after one call when the first page is short", async () => {
    const fn = vi.fn(async () => [1, 2, 3]);
    expect(await fetchAllPages(fn)).toHaveLength(3);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("makes one more (empty) call when a page is exactly full", async () => {
    const sizes = [1000, 0];
    let n = 0;
    const rows = await fetchAllPages(async () => Array.from({ length: sizes[n++] }, () => 1));
    expect(rows).toHaveLength(1000);
    expect(n).toBe(2);
  });
});

describe("fetchBoardCounts", () => {
  it("counts every document across pages (fake client with a 1000-row cap)", async () => {
    const total = 2003;
    const builder = () => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "is", "neq", "order"]) q[m] = () => q;
      q.range = (from: number, to: number) =>
        Promise.resolve({
          data: Array.from({ length: Math.max(0, Math.min(to + 1, total) - from) }, () => ({ application_id: "a1", lead_id: "l1" })),
        });
      return q;
    };
    const client = { from: () => builder() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await fetchBoardCounts(client as any, "t", [{ id: "a1", lead_id: "l1" }]);
    expect(r.docsByApplication.get("a1")).toBe(2003);
    expect(r.openTasksByLead.get("l1")).toBe(2003);
  });
});

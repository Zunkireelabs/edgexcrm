import { describe, it, expect } from "vitest";
import { fetchAllRows, type PageResult } from "./paginate";

// The ordering contract (see paginate.ts): offset paging over an UNORDERED
// result can return the same row on two pages or skip a row at a page
// boundary. It only bites above pageSize rows — exactly the scale the helper
// exists for — and produces no error. These tests exercise both the correct
// (ordered) path and prove the failure mode a small unordered test would hide.

interface Row {
  id: number;
}

// A fake table that only returns a stable, complete page slice when the query
// declares an order; without an order it simulates Postgres's freedom to
// reorder rows between page requests — which drops the row on the boundary.
function makeFakeTable(total: number) {
  const rows: Row[] = Array.from({ length: total }, (_, i) => ({ id: i }));
  return {
    ordered(offset: number, limit: number): PageResult<Row> {
      return { data: rows.slice(offset, offset + limit), error: null };
    },
    unordered(offset: number, limit: number): PageResult<Row> {
      // Models "no ORDER BY, so the planner may hand back rows in a different
      // order on each scan": rotate the array left by the page index before
      // slicing this window. A row on a page boundary then lands outside every
      // window (skipped) while another gets returned twice (duplicated).
      const pageIndex = Math.floor(offset / limit);
      const rotated = [...rows.slice(pageIndex), ...rows.slice(0, pageIndex)];
      return { data: rotated.slice(offset, offset + limit), error: null };
    },
  };
}

describe("fetchAllRows", () => {
  it("assembles every row exactly once across multiple pages when ordered", async () => {
    const table = makeFakeTable(2500);
    const out = await fetchAllRows<Row>((offset, limit) => Promise.resolve(table.ordered(offset, limit)), 1000);

    expect(out).toHaveLength(2500);
    const ids = out.map((r) => r.id).sort((a, b) => a - b);
    expect(ids).toEqual(Array.from({ length: 2500 }, (_, i) => i));
    // No duplicates.
    expect(new Set(out.map((r) => r.id)).size).toBe(2500);
  });

  it("returns a short final page result without an extra empty fetch", async () => {
    let calls = 0;
    const table = makeFakeTable(1500);
    await fetchAllRows<Row>((offset, limit) => {
      calls++;
      return Promise.resolve(table.ordered(offset, limit));
    }, 1000);
    expect(calls).toBe(2); // 1000 + 500, stops on the short page
  });

  it("would drop or duplicate a boundary row if the query is unordered (the bug the contract prevents)", async () => {
    const table = makeFakeTable(2500);
    const out = await fetchAllRows<Row>((offset, limit) => Promise.resolve(table.unordered(offset, limit)), 1000);

    // The unordered fake never assembles a clean set — this asserts the
    // failure mode exists, so the ordered test above is meaningful.
    const unique = new Set(out.map((r) => r.id));
    expect(unique.size).not.toBe(2500);
  });

  it("throws when the accumulated result exceeds maxRows instead of silently truncating", async () => {
    const table = makeFakeTable(50_000);
    await expect(fetchAllRows<Row>((offset, limit) => Promise.resolve(table.ordered(offset, limit)), 1000, 10_000)).rejects.toThrow(/maxRows/);
  });

  it("propagates a query error", async () => {
    await expect(fetchAllRows<Row>(() => Promise.resolve({ data: null, error: { message: "boom" } }))).rejects.toThrow("boom");
  });
});

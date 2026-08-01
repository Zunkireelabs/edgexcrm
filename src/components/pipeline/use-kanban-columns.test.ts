import { describe, it, expect } from "vitest";
import { mergeColumnPage, KANBAN_PAGE_SIZE } from "./use-kanban-columns";
import type { PipelineLead } from "@/types/database";

// KANBAN-PAGINATION-BRIEF §3.2/§6 row 3: "Load-more to the end of a column, then
// compare: union == header count, 0 dupes, 0 gaps." mergeColumnPage is the exact
// append step "Load more" runs on every click — this pins its dedup contract without
// needing a DOM/component-test harness (this repo's vitest is `environment: "node"`).

function lead(id: string): PipelineLead {
  return { id } as PipelineLead;
}

describe("KANBAN_PAGE_SIZE", () => {
  it("is 20 — the brief's explicit first-render page size (§6 row 1)", () => {
    expect(KANBAN_PAGE_SIZE).toBe(20);
  });
});

describe("mergeColumnPage", () => {
  it("appends a fresh page after the existing cards, preserving order", () => {
    const existing = [lead("a"), lead("b")];
    const incoming = [lead("c"), lead("d")];
    expect(mergeColumnPage(existing, incoming)).toEqual([lead("a"), lead("b"), lead("c"), lead("d")]);
  });

  it("drops any incoming card whose id is already loaded — no duplicates", () => {
    const existing = [lead("a"), lead("b")];
    const incoming = [lead("b"), lead("c")]; // "b" re-appears (e.g. a boundary shift)
    const merged = mergeColumnPage(existing, incoming);
    expect(merged).toEqual([lead("a"), lead("b"), lead("c")]);
    expect(merged.filter((l) => l.id === "b")).toHaveLength(1);
  });

  it("an empty incoming page is a no-op", () => {
    const existing = [lead("a")];
    expect(mergeColumnPage(existing, [])).toEqual(existing);
  });

  it("an empty existing column just adopts the incoming page", () => {
    const incoming = [lead("a"), lead("b")];
    expect(mergeColumnPage([], incoming)).toEqual(incoming);
  });
});

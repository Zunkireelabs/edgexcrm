import { describe, expect, it } from "vitest";
import { decodeFilterTree, encodeFilterTree } from "@/lib/filters/serialize";
import type { FilterTree } from "@/lib/filters/types";
import {
  DEFAULT_SORT,
  baselineFromState,
  canonicalTreeSignature,
  discardToBaseline,
  isSortDirty,
  isViewDirty,
  type ViewBaseline,
} from "./view-state";

const empty: FilterTree = { conjunction: "and", conditions: [] };

function tree(...conditions: FilterTree["conditions"]): FilterTree {
  return { conjunction: "and", conditions };
}

const baseline: ViewBaseline = {
  id: "all",
  tree: empty,
  sort: DEFAULT_SORT,
};

describe("isViewDirty", () => {
  it("is clean when nothing changed", () => {
    expect(isViewDirty(baseline, { tree: empty, sort: DEFAULT_SORT })).toBe(false);
  });

  it("is dirty when a filter is added", () => {
    const t = tree({ id: "a", field: "stage", op: "is", value: "s1" });
    expect(isViewDirty(baseline, { tree: t, sort: DEFAULT_SORT })).toBe(true);
  });

  it("is dirty when only the sort differs, and isSortDirty says so", () => {
    const current = { tree: empty, sort: { field: "name", direction: "asc" as const } };
    expect(isViewDirty(baseline, current)).toBe(true);
    expect(isSortDirty(baseline, current)).toBe(true);
  });

  it("is dirty when only the sort direction flips", () => {
    expect(isViewDirty(baseline, { tree: empty, sort: { field: "activity", direction: "asc" } })).toBe(true);
  });

  it("ignores condition ids (they are random per client)", () => {
    const a = tree({ id: "one", field: "stage", op: "is", value: "s1" });
    const b = tree({ id: "two", field: "stage", op: "is", value: "s1" });
    expect(canonicalTreeSignature(a)).toBe(canonicalTreeSignature(b));
    expect(isViewDirty({ ...baseline, tree: a }, { tree: b, sort: DEFAULT_SORT })).toBe(false);
  });

  it("ignores chip order", () => {
    const x = { id: "1", field: "stage", op: "is", value: "s1" } as const;
    const y = { id: "2", field: "assigned_to", op: "is", value: "u1" } as const;
    expect(canonicalTreeSignature(tree(x, y))).toBe(canonicalTreeSignature(tree(y, x)));
  });

  it("ignores the order of multi-select values", () => {
    const a = tree({ id: "1", field: "stage", op: "is_any_of", value: ["a", "b"] });
    const b = tree({ id: "1", field: "stage", op: "is_any_of", value: ["b", "a"] });
    expect(canonicalTreeSignature(a)).toBe(canonicalTreeSignature(b));
  });

  it("does NOT ignore the order of a range (order is meaning)", () => {
    const a = tree({ id: "1", field: "created", op: "date_between", value: ["2026-01-01", "2026-02-01"] });
    const b = tree({ id: "1", field: "created", op: "date_between", value: ["2026-02-01", "2026-01-01"] });
    expect(canonicalTreeSignature(a)).not.toBe(canonicalTreeSignature(b));
  });

  it("treats a changed value as dirty", () => {
    const a = tree({ id: "1", field: "stage", op: "is", value: "s1" });
    const b = tree({ id: "1", field: "stage", op: "is", value: "s2" });
    expect(isViewDirty({ ...baseline, tree: a }, { tree: b, sort: DEFAULT_SORT })).toBe(true);
  });

  it("treats a changed operator as dirty", () => {
    const a = tree({ id: "1", field: "stage", op: "is", value: "s1" });
    const b = tree({ id: "1", field: "stage", op: "is_not", value: "s1" });
    expect(canonicalTreeSignature(a)).not.toBe(canonicalTreeSignature(b));
  });

  it("ignores empty groups but not populated ones", () => {
    const withEmptyGroup: FilterTree = { ...empty, groups: [{ conjunction: "or", conditions: [] }] };
    expect(canonicalTreeSignature(withEmptyGroup)).toBe(canonicalTreeSignature(empty));
    const withGroup: FilterTree = {
      ...empty,
      groups: [{ conjunction: "or", conditions: [{ id: "g", field: "stage", op: "is", value: "s1" }] }],
    };
    expect(canonicalTreeSignature(withGroup)).not.toBe(canonicalTreeSignature(empty));
  });
});

describe("discardToBaseline", () => {
  it("restores the baseline exactly", () => {
    const saved = tree({ id: "1", field: "stage", op: "is", value: "s1" });
    const b: ViewBaseline = { id: "v1", tree: saved, sort: { field: "name", direction: "asc" } };
    const restored = discardToBaseline(b);
    expect(restored.tree).toEqual(saved);
    expect(restored.sort).toEqual(b.sort);
    expect(isViewDirty(b, restored)).toBe(false);
  });

  it("returns copies, so later edits to the live state cannot corrupt the baseline", () => {
    const saved = tree({ id: "1", field: "stage", op: "is", value: "s1" });
    const b: ViewBaseline = { id: "v1", tree: saved, sort: DEFAULT_SORT };
    const restored = discardToBaseline(b);
    restored.tree.conditions.push({ id: "2", field: "assigned_to", op: "is", value: "u1" });
    restored.sort.field = "email";
    expect(b.tree.conditions).toHaveLength(1);
    expect(b.sort.field).toBe("activity");
  });
});

describe("baselineFromState (Save as view)", () => {
  it("makes the saved state the new clean baseline", () => {
    const current = {
      tree: tree({ id: "1", field: "stage", op: "is", value: "s1" }),
      sort: { field: "created", direction: "desc" as const },
    };
    const next = baselineFromState("saved-1", current);
    expect(next.id).toBe("saved-1");
    expect(isViewDirty(next, current)).toBe(false);
  });
});

describe("chip serialisation round-trip (URL ?f=)", () => {
  it("encode → decode keeps the same canonical signature", () => {
    const t = tree(
      { id: "a", field: "stage", op: "is_any_of", value: ["s2", "s1"] },
      { id: "b", field: "assigned_to", op: "is", value: "user-1" },
      { id: "c", field: "email", op: "is_empty" },
    );
    const decoded = decodeFilterTree(encodeFilterTree(t));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(canonicalTreeSignature(decoded.tree)).toBe(canonicalTreeSignature(t));
    // and the URL round trip never makes the active view look edited
    expect(isViewDirty({ id: "v", tree: t, sort: DEFAULT_SORT }, { tree: decoded.tree, sort: DEFAULT_SORT })).toBe(false);
  });
});

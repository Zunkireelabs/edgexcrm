import { describe, expect, it } from "vitest";
import { decodeFilterTree } from "@/lib/filters/serialize";
import type { FilterCondition, FilterTree } from "@/lib/filters/types";
import { chipValueText, conditionForPickedValues, plainOperatorLabel, selectedValues, toggleValue } from "./chip-parts";
import { buildCountParams, treeWithoutField } from "./lead-count";
import { filterOptionRows, toOptionRows } from "./option-view";

const opts = [
  { value: "u1", label: "Diplov Karki (449)" },
  { value: "u2", label: "Nikhil Mahat (0)" },
  { value: "s1", label: "Event (2025)" },
];

describe("plainOperatorLabel", () => {
  const c = (op: FilterCondition["op"], value?: FilterCondition["value"]): FilterCondition => ({ id: "x", field: "stage", op, value });
  it("shows a single pick as plain 'is' / 'is not'", () => {
    expect(plainOperatorLabel(c("is_any_of", ["a"]))).toBe("is");
    expect(plainOperatorLabel(c("is_none_of", ["a"]))).toBe("is not");
    expect(plainOperatorLabel(c("is", "a"))).toBe("is");
  });
  it("keeps 'is any of' for a real multi-pick, and spells empties in words", () => {
    expect(plainOperatorLabel(c("is_any_of", ["a", "b"]))).toBe("is any of");
    expect(plainOperatorLabel(c("is_empty"))).toBe("is empty");
    expect(plainOperatorLabel(c("is_not_empty"))).toBe("is not empty");
    expect(plainOperatorLabel(c("contains", "x"))).toBe("contains");
  });
});

describe("chipValueText / selectedValues", () => {
  it("has no value text for empty-style operators", () => {
    expect(chipValueText({ id: "x", field: "email", op: "is_empty" }, [])).toBe("");
  });
  it("names the picked option, never the raw id", () => {
    expect(chipValueText({ id: "x", field: "stage", op: "is_any_of", value: ["u1"] }, [{ value: "u1", label: "Diplov Karki" }])).toBe("Diplov Karki");
  });
  it("treats a scalar `is` as a one-item selection, and a blank value as none", () => {
    expect(selectedValues({ id: "x", field: "stage", op: "is", value: "a" })).toEqual(["a"]);
    expect(selectedValues({ id: "x", field: "stage", op: "is", value: "" })).toEqual([]);
    expect(selectedValues(undefined)).toEqual([]);
  });
});

describe("Pick-values selection", () => {
  it("toggles in and out", () => {
    expect(toggleValue(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleValue(["a", "b"], "a")).toEqual(["b"]);
  });
  it("produces one set condition, negative when asked, and null when nothing is ticked", () => {
    expect(conditionForPickedValues({ id: "c", field: "stage" }, ["a", "b"], false)).toEqual({ id: "c", field: "stage", op: "is_any_of", value: ["a", "b"] });
    expect(conditionForPickedValues({ id: "c", field: "stage" }, ["a"], true)?.op).toBe("is_none_of");
    expect(conditionForPickedValues({ id: "c", field: "stage" }, [], false)).toBeNull();
  });
});

describe("toOptionRows", () => {
  const counts = new Map([["u1", 449], ["u2", 0]]);

  it("splits the exact countSuffix off the label and exposes the number", () => {
    const rows = toOptionRows("assignees", opts, { assignees: counts });
    expect(rows[0]).toMatchObject({ label: "Diplov Karki", count: 449 });
    expect(rows[1]).toMatchObject({ label: "Nikhil Mahat", count: 0 });
  });

  it("does NOT eat a name that merely looks like a count (no matching count map entry)", () => {
    const rows = toOptionRows("assignees", opts, { assignees: counts });
    // s1 isn't in the map -> countSuffix gives " (0)" which doesn't match " (2025)" -> label untouched, no count
    expect(rows[2]).toMatchObject({ label: "Event (2025)" });
    expect(rows[2].count).toBeUndefined();
  });

  it("shows no number at all when there is no count source (never fabricates)", () => {
    const rows = toOptionRows("stage", [{ value: "s", label: "Qualified" }], {});
    expect(rows[0].count).toBeUndefined();
  });

  it("takes lazily fetched extra counts (stage) when the label carries none", () => {
    const rows = toOptionRows("stage", [{ value: "s", label: "Qualified" }], {}, new Map([["s", 188]]));
    expect(rows[0]).toMatchObject({ label: "Qualified", count: 188 });
  });

  it("filters rows case-insensitively", () => {
    const rows = toOptionRows("assignees", opts, { assignees: counts });
    expect(filterOptionRows(rows, "  dIP ").map((r) => r.value)).toEqual(["u1"]);
    expect(filterOptionRows(rows, "")).toHaveLength(3);
  });
});

describe("count requests", () => {
  const tree: FilterTree = {
    conjunction: "and",
    conditions: [
      { id: "1", field: "stage", op: "is", value: "s1" },
      { id: "2", field: "assignees", op: "is", value: "u1" },
    ],
  };

  it("asks for exactly one row plus the exact count, scoped to a list", () => {
    const p = buildCountParams({ listSlug: "applications" });
    expect(p.get("pageSize")).toBe("1");
    expect(p.get("count")).toBe("1");
    expect(p.get("list")).toBe("applications");
    expect(p.has("f")).toBe(false);
  });

  it("encodes a non-empty tree as ?f= and survives decode", () => {
    const p = buildCountParams({ tree });
    const decoded = decodeFilterTree(p.get("f")!);
    expect(decoded.ok && decoded.tree.conditions).toHaveLength(2);
  });

  it("omits ?f= for an empty tree", () => {
    expect(buildCountParams({ tree: { conjunction: "and", conditions: [] } }).has("f")).toBe(false);
  });

  it("an option's own count ignores its own field only", () => {
    const t = treeWithoutField(tree, "stage");
    expect(t.conditions.map((c) => c.field)).toEqual(["assignees"]);
  });
});

import { findConditionForField, removeCondition, upsertCondition } from "./tree-edit";

describe("tree edits", () => {
  const base: FilterTree = { conjunction: "and", conditions: [{ id: "a", field: "stage", op: "is_any_of", value: ["s1"] }] };

  it("replaces by id, keeping the chip's slot", () => {
    const next = upsertCondition(base, { id: "a", field: "stage", op: "is_any_of", value: ["s1", "s2"] });
    expect(next.conditions).toHaveLength(1);
    expect(next.conditions[0].value).toEqual(["s1", "s2"]);
  });

  it("appends a new field's condition", () => {
    const next = upsertCondition(base, { id: "b", field: "assignees", op: "is_any_of", value: ["u1"] });
    expect(next.conditions.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("folds a second pick on the same field into the existing chip (never two ANDed Stage chips)", () => {
    const next = upsertCondition(base, { id: "z", field: "stage", op: "is_any_of", value: ["s2"] });
    expect(next.conditions).toHaveLength(1);
    expect(next.conditions[0].value).toEqual(["s1", "s2"]);
  });

  it("removes by id and finds by field", () => {
    expect(removeCondition(base, "a").conditions).toHaveLength(0);
    expect(findConditionForField(base, "stage")?.id).toBe("a");
    expect(findConditionForField(base, "email")).toBeUndefined();
  });
});

import { buildBuiltinViews } from "./builtin-views";
import { isViewDirty } from "./view-state";

describe("built-in view tabs", () => {
  const scopeTree: FilterTree = { conjunction: "and", conditions: [] };
  const all = new Set(["assignees", "stage"]);

  it("builds All / My / Applications from existing registry fields", () => {
    const v = buildBuiltinViews({ scopeTree, currentUserId: "u1", fieldKeys: all, applicationsListId: "l-apps" });
    expect(v.map((x) => x.id)).toEqual(["all", "mine", "applications"]);
    expect(v[1].tree.conditions[0]).toMatchObject({ field: "assignees", op: "is_any_of", value: ["u1"] });
    expect(v[2].tree.conditions[0]).toMatchObject({ field: "stage", op: "is_any_of", value: ["l-apps"] });
    expect(v[2].showCount).toBe(true);
    expect(v[0].showCount).toBe(false);
  });

  it("hides a tab whose field the tenant can't filter by, or whose list doesn't exist", () => {
    expect(buildBuiltinViews({ scopeTree, currentUserId: "u1", fieldKeys: new Set(["stage"]), applicationsListId: null }).map((x) => x.id)).toEqual(["all"]);
    expect(buildBuiltinViews({ scopeTree, currentUserId: "", fieldKeys: all, applicationsListId: "l" }).map((x) => x.id)).toEqual(["all", "applications"]);
  });

  it("does not define a Needs follow-up tab (owned by EDGEX-87 / EDGEX-121)", () => {
    const v = buildBuiltinViews({ scopeTree, currentUserId: "u1", fieldKeys: all, applicationsListId: "l" });
    expect(v.some((x) => x.id === "needs-follow-up")).toBe(false);
  });

  it("a tab is clean when selected and dirty once the user edits it", () => {
    const [, mine] = buildBuiltinViews({ scopeTree, currentUserId: "u1", fieldKeys: all, applicationsListId: null });
    const baseline = { id: mine.id, tree: mine.tree, sort: mine.sort };
    expect(isViewDirty(baseline, { tree: mine.tree, sort: mine.sort })).toBe(false);
    const edited: FilterTree = { ...mine.tree, conditions: [...mine.tree.conditions, { id: "n", field: "stage", op: "is", value: "s" }] };
    expect(isViewDirty(baseline, { tree: edited, sort: mine.sort })).toBe(true);
  });
});

import { SORT_OPTIONS, directionOptions, isDefaultSort, sortOption, withDirection, withField } from "./sort-options";
import { DEFAULT_SORT } from "./view-state";

describe("one-level sort rules", () => {
  it("offers the same fields as the old popover", () => {
    expect(SORT_OPTIONS.map((o) => o.key)).toEqual(["activity", "created", "updated", "name", "email", "follow_up_needed"]);
  });

  it("words directions by field kind", () => {
    expect(directionOptions("date").map((d) => d.label)).toEqual(["Newest first", "Oldest first"]);
    expect(directionOptions("text").map((d) => d.label)).toEqual(["A to Z", "Z to A"]);
    expect(directionOptions("stale")).toEqual([{ direction: "asc", label: "Stalest first" }]);
  });

  it("forces ascending when switching to Follow-up needed, keeps direction otherwise", () => {
    expect(withField({ field: "activity", direction: "desc" }, "follow_up_needed")).toEqual({ field: "follow_up_needed", direction: "asc" });
    expect(withField({ field: "activity", direction: "asc" }, "name")).toEqual({ field: "name", direction: "asc" });
    expect(withField({ field: "activity", direction: "desc" }, "created")).toEqual({ field: "created", direction: "desc" });
  });

  it("ignores a direction a fixed-direction field doesn't allow", () => {
    const s = { field: "follow_up_needed", direction: "asc" as const };
    expect(withDirection(s, "desc")).toBe(s);
    expect(withDirection({ field: "name", direction: "asc" }, "desc")).toEqual({ field: "name", direction: "desc" });
  });

  it("falls back to the first option for an unknown key, and recognises the default", () => {
    expect(sortOption("nope").key).toBe("activity");
    expect(isDefaultSort(DEFAULT_SORT)).toBe(true);
    expect(isDefaultSort({ field: "name", direction: "asc" })).toBe(false);
  });
});

import { matchBuiltinView } from "./builtin-views";

describe("implicit active view", () => {
  const scopeTree: FilterTree = { conjunction: "and", conditions: [] };
  const views = buildBuiltinViews({ scopeTree, currentUserId: "u1", fieldKeys: new Set(["assignees", "stage"]), applicationsListId: "l-apps" });

  it("treats a restored Applications filter as the Applications tab (clean), not All + unsaved", () => {
    const restored: FilterTree = { conjunction: "and", conditions: [{ id: "random", field: "stage", op: "is_any_of", value: ["l-apps"] }] };
    expect(matchBuiltinView(views, { tree: restored, sort: DEFAULT_SORT })?.id).toBe("applications");
  });

  it("matches All for no filters, and nothing for an unrelated filter or a changed sort", () => {
    expect(matchBuiltinView(views, { tree: scopeTree, sort: DEFAULT_SORT })?.id).toBe("all");
    const other: FilterTree = { conjunction: "and", conditions: [{ id: "x", field: "stage", op: "is_any_of", value: ["l-other"] }] };
    expect(matchBuiltinView(views, { tree: other, sort: DEFAULT_SORT })).toBeNull();
    expect(matchBuiltinView(views, { tree: scopeTree, sort: { field: "name", direction: "asc" } })).toBeNull();
  });
});

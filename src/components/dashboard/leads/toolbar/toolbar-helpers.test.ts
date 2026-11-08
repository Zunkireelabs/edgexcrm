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

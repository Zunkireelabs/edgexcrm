import { describe, it, expect } from "vitest";
import { defaultOperatorForField, defaultValueForOperator, reshapeValueForOperator, addOrMergeCondition } from "./condition-defaults";
import type { FieldDef, FilterCondition } from "@/lib/filters/types";

const dateField: FieldDef = {
  key: "created_at",
  label: "Created at",
  type: "date",
  source: { kind: "column", column: "created_at" },
  group: "Dates",
  filterable: true,
};

const textField: FieldDef = {
  key: "first_name",
  label: "First name",
  type: "text",
  source: { kind: "column", column: "first_name" },
  group: "Basic",
  filterable: true,
};

const searchField: FieldDef = {
  key: "search",
  label: "Search (name, email, phone, ID)",
  type: "text",
  source: { kind: "column", column: "search" },
  group: "Basic",
  filterable: true,
};

const cityField: FieldDef = {
  key: "city",
  label: "City",
  type: "text",
  source: { kind: "column", column: "city" },
  group: "Basic",
  filterable: true,
};

describe("defaultOperatorForField", () => {
  it('picks "on" for a date field, not "is_empty" (index 0 in OPERATORS_BY_TYPE.date) — a brand-new date filter should default to something useful, not an almost-always-empty result', () => {
    expect(defaultOperatorForField(dateField)).toBe("on");
  });

  it("still picks operators[0] for every other field type — unaffected", () => {
    expect(defaultOperatorForField(textField)).toBe("is");
  });

  it("falls back to operators[0] if a field's custom operator list doesn't include \"on\" (defensive, no live registry field does this today)", () => {
    const noOnDateField: FieldDef = { ...dateField, operators: ["is_empty", "is_not_empty"] };
    expect(defaultOperatorForField(noOnDateField)).toBe("is_empty");
  });

  it('picks "contains" for the dedicated "search" field, not "is" (index 0) — a free-text multi-column search is never meaningfully exact-matched (F-14: SMS-PHASE4-FIX-F14-BRIEF.md)', () => {
    expect(defaultOperatorForField(searchField)).toBe("contains");
  });

  it('still picks "is" for other text-type fields like city — the search-only default does not leak to other text fields', () => {
    expect(defaultOperatorForField(cityField)).toBe("is");
  });
});

describe("reshapeValueForOperator", () => {
  it('does NOT carry a date-string value over when switching "before" -> "within_last" — the old value is the wrong shape for a relative-date token and would throw on Apply if kept', () => {
    const reshaped = reshapeValueForOperator(dateField, "before", "within_last", "2026-08-01");
    expect(reshaped).toBe(defaultValueForOperator(dateField, "within_last"));
    expect(reshaped).not.toBe("2026-08-01");
  });

  it('does NOT carry a relative-date token over when switching "within_last" -> "before" (the reverse direction)', () => {
    const reshaped = reshapeValueForOperator(dateField, "within_last", "before", "7d");
    expect(reshaped).not.toBe("7d");
  });

  it('DOES carry the value over switching between the two relative-date operators ("within_last" <-> "within_next") — same shape, still a valid token', () => {
    expect(reshapeValueForOperator(dateField, "within_last", "within_next", "30d")).toBe("30d");
    expect(reshapeValueForOperator(dateField, "within_next", "within_last", "1y")).toBe("1y");
  });

  it("still carries the value over between two ordinary scalar operators (regression: this worked before and must keep working)", () => {
    expect(reshapeValueForOperator(dateField, "before", "after", "2026-08-01")).toBe("2026-08-01");
    expect(reshapeValueForOperator(textField, "is", "is_not", "Jane")).toBe("Jane");
  });

  it("still carries the value over between two list operators (is_any_of <-> is_none_of) — regression", () => {
    const uuidField: FieldDef = { ...textField, type: "uuid" };
    expect(reshapeValueForOperator(uuidField, "is_any_of", "is_none_of", ["u1", "u2"])).toEqual(["u1", "u2"]);
  });
});

describe("addOrMergeCondition", () => {
  const stageA: FilterCondition = { id: "c1", field: "stage", op: "is", value: "list-a" };

  it('picking the same field twice via "is" folds into one is_any_of condition, not two AND-able ones (regression: this used to append a second condition that could never both match — e.g. two Stage picks silently zeroed every result)', () => {
    const stageB: FilterCondition = { id: "c2", field: "stage", op: "is", value: "list-b" };
    const result = addOrMergeCondition([stageA], stageB);
    expect(result).toEqual([{ id: "c1", field: "stage", op: "is_any_of", value: ["list-a", "list-b"] }]);
  });

  it("merges a fresh is_any_of pick into an existing is_any_of condition, deduping repeats", () => {
    const existing: FilterCondition = { id: "c1", field: "stage", op: "is_any_of", value: ["list-a", "list-b"] };
    const next: FilterCondition = { id: "c2", field: "stage", op: "is_any_of", value: ["list-b", "list-c"] };
    const result = addOrMergeCondition([existing], next);
    expect(result).toEqual([{ id: "c1", field: "stage", op: "is_any_of", value: ["list-a", "list-b", "list-c"] }]);
  });

  it("appends as a separate condition when no existing condition shares the field", () => {
    const other: FilterCondition = { id: "c1", field: "source", op: "is", value: "walk-in" };
    expect(addOrMergeCondition([other], stageA)).toEqual([other, stageA]);
  });

  it('does NOT merge range-style operators on the same field — "created after X" + "created before Y" is a real, intentional AND, not a duplicate pick', () => {
    const after: FilterCondition = { id: "c1", field: "created_at", op: "after", value: "2026-01-01" };
    const before: FilterCondition = { id: "c2", field: "created_at", op: "before", value: "2026-02-01" };
    expect(addOrMergeCondition([after], before)).toEqual([after, before]);
  });

  it("does NOT merge into an existing negative condition (is_not) — different intent, left as two AND'd conditions", () => {
    const isNot: FilterCondition = { id: "c1", field: "stage", op: "is_not", value: "list-a" };
    const isB: FilterCondition = { id: "c2", field: "stage", op: "is", value: "list-b" };
    expect(addOrMergeCondition([isNot], isB)).toEqual([isNot, isB]);
  });
});

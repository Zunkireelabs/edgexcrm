import { describe, it, expect } from "vitest";
import { defaultOperatorForField, defaultValueForOperator, reshapeValueForOperator } from "./condition-defaults";
import type { FieldDef } from "@/lib/filters/types";

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

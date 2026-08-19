// Shared helpers for staging a FilterCondition being edited in the UI —
// picking a sane default operator/value when a field is first chosen, and
// producing a stable id. Pure, no React — used by both the "add" and
// "edit in place" flows (AddFilterButton and FilterChip share one editor).

import type { FieldDef, FilterCondition, FilterOperator, FilterValue } from "@/lib/filters/types";
import { operatorsForField } from "@/lib/filters/operators";

export function newConditionId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `c_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

const RELATIVE_DATE_OPERATORS: readonly FilterOperator[] = ["within_last", "within_next"];

export function defaultOperatorForField(field: FieldDef): FilterOperator {
  const operators = operatorsForField(field);
  // OPERATORS_BY_TYPE.date lists "is_empty"/"is_not_empty" first (unlike every
  // other field type, where index 0 is a value-bearing, commonly-intended
  // operator) — picking [0] blindly means a brand-new date filter defaults to
  // "is empty" (almost always zero matches) instead of something useful.
  // Prefer "on" for date fields specifically; every other type keeps [0].
  if (field.type === "date" && operators.includes("on")) return "on";
  return operators[0];
}
const TUPLE_OPERATORS: readonly FilterOperator[] = ["between", "date_between"];
const LIST_OPERATORS: readonly FilterOperator[] = ["is_any_of", "is_none_of", "has_all"];
const NO_VALUE_OPERATORS: readonly FilterOperator[] = ["is_empty", "is_not_empty", "is_true", "is_false"];

export function defaultValueForOperator(field: FieldDef, op: FilterOperator): FilterValue | undefined {
  if (NO_VALUE_OPERATORS.includes(op)) return undefined;
  if (LIST_OPERATORS.includes(op)) return [];
  if (op === "between") return field.type === "number" ? [0, 0] : ["", ""];
  if (op === "date_between") return ["", ""];
  if (RELATIVE_DATE_OPERATORS.includes(op)) return "7d";
  if (field.type === "date") return new Date().toISOString().slice(0, 10);
  if (field.type === "number") return 0;
  return "";
}

export function newConditionForField(field: FieldDef): FilterCondition {
  const op = defaultOperatorForField(field);
  return { id: newConditionId(), field: field.key, op, value: defaultValueForOperator(field, op) };
}

// Operators where "picking this field again" can only sanely mean "add this
// value to the set" — a single positive value or an existing OR-list. Range-
// style pairs (date before/after, number gt/lt) are deliberately excluded:
// two of those on the same field is a real, intentional AND ("after X AND
// before Y"), not a duplicate pick to merge.
const MERGEABLE_ADD_OPERATORS: readonly FilterOperator[] = ["is", "is_any_of"];

function asValueList(value: FilterValue | undefined): string[] {
  if (Array.isArray(value)) return value.map(String);
  return value === undefined ? [] : [String(value)];
}

// Appends `next` to `conditions` — UNLESS a condition for the same field
// already carries a mergeable operator, in which case `next`'s value is
// folded into it (upgrading to is_any_of) instead of appending a second,
// competing condition. Two separate "field is A" / "field is B" conditions
// AND together to an impossible, silently-zero-row match — this is the one
// place every "+ Add filter" flow in the app routes through, so fixing it
// here fixes every field, not just the one that surfaced it.
export function addOrMergeCondition(conditions: FilterCondition[], next: FilterCondition): FilterCondition[] {
  if (!MERGEABLE_ADD_OPERATORS.includes(next.op)) return [...conditions, next];

  const existingIndex = conditions.findIndex((c) => c.field === next.field && MERGEABLE_ADD_OPERATORS.includes(c.op));
  if (existingIndex === -1) return [...conditions, next];

  const merged = Array.from(new Set([...asValueList(conditions[existingIndex].value), ...asValueList(next.value)]));
  return conditions.map((c, i) => (i === existingIndex ? { ...c, op: "is_any_of", value: merged } : c));
}

// When the operator changes on an existing condition, the old value's shape
// is very likely wrong for the new operator's arity (e.g. scalar -> list) —
// re-derive a fresh default rather than carrying over a mismatched shape.
function isGenericScalar(op: FilterOperator): boolean {
  // Everything NOT already bucketed above. Relative-date operators ("within
  // the last 7d") must NOT fall in here — their value is a strict "7d"-style
  // token, incompatible with e.g. "before"'s ISO-date-string value, even
  // though both are technically "a single string." Without carving this out,
  // switching a date filter from "before" to "within the last" carries the
  // old date string over verbatim, which then throws when Applied (invalid
  // relative date value) instead of resetting to a valid default.
  return !LIST_OPERATORS.includes(op) && !TUPLE_OPERATORS.includes(op) && !NO_VALUE_OPERATORS.includes(op) && !RELATIVE_DATE_OPERATORS.includes(op);
}

export function reshapeValueForOperator(field: FieldDef, prevOp: FilterOperator, nextOp: FilterOperator, prevValue: FilterValue | undefined): FilterValue | undefined {
  const sameShape =
    (LIST_OPERATORS.includes(prevOp) && LIST_OPERATORS.includes(nextOp)) ||
    (TUPLE_OPERATORS.includes(prevOp) && TUPLE_OPERATORS.includes(nextOp)) ||
    (RELATIVE_DATE_OPERATORS.includes(prevOp) && RELATIVE_DATE_OPERATORS.includes(nextOp)) ||
    (isGenericScalar(prevOp) && isGenericScalar(nextOp));
  if (sameShape) return prevValue;
  return defaultValueForOperator(field, nextOp);
}

export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  is: "is",
  is_not: "is not",
  is_empty: "is empty",
  is_not_empty: "is not empty",
  contains: "contains",
  not_contains: "does not contain",
  starts_with: "starts with",
  ends_with: "ends with",
  is_any_of: "is any of",
  is_none_of: "is none of",
  has_all: "has all of",
  gt: "greater than",
  gte: "greater than or equal to",
  lt: "less than",
  lte: "less than or equal to",
  between: "between",
  before: "before",
  after: "after",
  on: "on",
  date_between: "between",
  within_last: "within the last",
  within_next: "within the next",
  is_true: "is true",
  is_false: "is false",
};

export const RELATIVE_DATE_PRESETS = [
  { value: "1d", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "1m", label: "This month" },
];

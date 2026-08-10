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

export function defaultOperatorForField(field: FieldDef): FilterOperator {
  return operatorsForField(field)[0];
}

const RELATIVE_DATE_OPERATORS: readonly FilterOperator[] = ["within_last", "within_next"];
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

// When the operator changes on an existing condition, the old value's shape
// is very likely wrong for the new operator's arity (e.g. scalar -> list) —
// re-derive a fresh default rather than carrying over a mismatched shape.
export function reshapeValueForOperator(field: FieldDef, prevOp: FilterOperator, nextOp: FilterOperator, prevValue: FilterValue | undefined): FilterValue | undefined {
  const sameShape =
    (LIST_OPERATORS.includes(prevOp) && LIST_OPERATORS.includes(nextOp)) ||
    (TUPLE_OPERATORS.includes(prevOp) && TUPLE_OPERATORS.includes(nextOp)) ||
    (!LIST_OPERATORS.includes(prevOp) && !TUPLE_OPERATORS.includes(prevOp) && !NO_VALUE_OPERATORS.includes(prevOp) && !LIST_OPERATORS.includes(nextOp) && !TUPLE_OPERATORS.includes(nextOp) && !NO_VALUE_OPERATORS.includes(nextOp));
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

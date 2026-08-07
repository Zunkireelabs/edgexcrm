import type { FieldDef, FilterFieldType, FilterOperator } from "./types";

// The operator x field-type mapping table. `is_none_of` is deliberately absent
// from `relation` — see compile.ts: `!inner` + `not.in` on an embedded relation
// means "has *a* row that isn't X", which is semantically wrong (and duplicates
// parent rows), not "has none of X". The UI must never offer it for a relation
// field, and the compiler 422s it if a caller tries anyway.
export const OPERATORS_BY_TYPE: Record<FilterFieldType, FilterOperator[]> = {
  text: ["is", "is_not", "is_empty", "is_not_empty", "contains", "not_contains", "starts_with", "ends_with"],
  number: ["is", "is_not", "is_empty", "is_not_empty", "gt", "gte", "lt", "lte", "between"],
  date: ["is_empty", "is_not_empty", "before", "after", "on", "date_between", "within_last", "within_next"],
  boolean: ["is_true", "is_false"],
  select: ["is", "is_not", "is_empty", "is_not_empty", "is_any_of", "is_none_of"],
  multiselect: ["is_any_of", "is_none_of", "has_all", "is_empty", "is_not_empty"],
  uuid: ["is", "is_not", "is_empty", "is_not_empty", "is_any_of", "is_none_of"],
  tags: ["has_all", "is_any_of", "is_none_of", "is_empty", "is_not_empty"],
  relation: ["is_any_of", "is_empty", "is_not_empty"],
};

export function operatorsForField(field: FieldDef): FilterOperator[] {
  return field.operators ?? OPERATORS_BY_TYPE[field.type];
}

export function isOperatorAllowed(field: FieldDef, op: FilterOperator): boolean {
  return operatorsForField(field).includes(op);
}

// Operators whose schema shape carries no `value` at all.
export const NO_VALUE_OPERATORS: readonly FilterOperator[] = ["is_empty", "is_not_empty", "is_true", "is_false"] as const;

// Operators whose value is a non-empty string[] (bounded — see schema.ts).
export const LIST_VALUE_OPERATORS: readonly FilterOperator[] = ["is_any_of", "is_none_of", "has_all"] as const;

// Operators whose value is a single scalar (string | number).
export const SCALAR_VALUE_OPERATORS: readonly FilterOperator[] = [
  "is",
  "is_not",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "gt",
  "gte",
  "lt",
  "lte",
  "before",
  "after",
  "on",
  "within_last",
  "within_next",
] as const;

// Operators whose value is a 2-tuple.
export const TUPLE_VALUE_OPERATORS: readonly FilterOperator[] = ["between", "date_between"] as const;

// Pure text/shape helpers for the sentence chips: [icon Field] [operator] [value ✕].
// No React — covered by chip-parts.test.ts.

import type { FieldDef, FilterCondition, FilterOperator } from "@/lib/filters/types";
import type { FilterOption } from "@/components/ui/filter-dropdown";
import { OPERATOR_LABELS } from "@/components/filters/condition-defaults";
import { formatConditionValue } from "@/components/filters/chip-label";

const NO_VALUE_OPS = new Set<FilterOperator>(["is_empty", "is_not_empty", "is_true", "is_false"]);

export function conditionHasValue(op: FilterOperator): boolean {
  return !NO_VALUE_OPS.has(op);
}

/**
 * Plain-word operator for the middle segment. "is any of [one value]" reads as just "is"
 * (that is how Attio shows a single pick, and the mockup's "Stage  is  Prospects"); only
 * a genuine multi-pick keeps "is any of".
 */
export function plainOperatorLabel(condition: FilterCondition): string {
  const { op, value } = condition;
  const single = Array.isArray(value) && value.length <= 1;
  if (op === "is_any_of" && single) return "is";
  if (op === "is_none_of" && single) return "is not";
  return OPERATOR_LABELS[op];
}

/** Text of the value segment ("Prospects", "Amit, Diplov +1", "Last 7 days", "1 Jan – 5 Jan"). */
export function chipValueText(condition: FilterCondition, options: FilterOption[]): string {
  if (!conditionHasValue(condition.op)) return "";
  return formatConditionValue(condition, options);
}

/** Option values a condition currently selects (scalar `is` counts as a one-item selection). */
export function selectedValues(condition: FilterCondition | undefined): string[] {
  if (!condition) return [];
  const { value } = condition;
  if (Array.isArray(value)) return value.map(String);
  return value === undefined || value === "" ? [] : [String(value)];
}

/** Whether a field is picked from a known list (so it gets the checkbox "Pick values" screen). */
export function isOptionField(field: FieldDef, options: FilterOption[]): boolean {
  if (options.length === 0) return false;
  return field.type === "select" || field.type === "multiselect" || field.type === "uuid" || field.type === "relation" || field.type === "tags";
}

/**
 * Condition produced by ticking/unticking a value in the Pick-values popover. Always a set
 * operator so several ticks stay one chip; untick-all returns null (the caller removes the chip).
 * `negate` keeps an existing "is not"/"none of" chip negative while its values change.
 */
export function conditionForPickedValues(
  base: Pick<FilterCondition, "id" | "field">,
  values: string[],
  negate: boolean,
): FilterCondition | null {
  if (values.length === 0) return null;
  return { id: base.id, field: base.field, op: negate ? "is_none_of" : "is_any_of", value: values };
}

export function toggleValue(current: string[], value: string): string[] {
  return current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
}

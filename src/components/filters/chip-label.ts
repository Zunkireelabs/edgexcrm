// Human-readable chip text — "Name: brian", "Status is not: Contacted",
// "Created within the last: Last 7 days". Matches the reference screenshots'
// "Field: value" shape, with the operator spelled out whenever it isn't the
// bare "is" (which reads fine as a bare colon).

import type { FieldDef, FilterCondition } from "@/lib/filters/types";
import type { FilterOption } from "@/components/ui/filter-dropdown";
import { OPERATOR_LABELS, RELATIVE_DATE_PRESETS } from "./condition-defaults";

const NO_VALUE_OPS = new Set(["is_empty", "is_not_empty", "is_true", "is_false"]);
const LIST_OPS = new Set(["is_any_of", "is_none_of", "has_all"]);

function optionLabel(options: FilterOption[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

function formatValue(condition: FilterCondition, options: FilterOption[]): string {
  const { op, value } = condition;

  if (op === "within_last" || op === "within_next") {
    return RELATIVE_DATE_PRESETS.find((p) => p.value === value)?.label ?? String(value);
  }
  if (LIST_OPS.has(op) && Array.isArray(value)) {
    const shown = (value as string[]).slice(0, 2).map((v) => optionLabel(options, v));
    const extra = (value as string[]).length - shown.length;
    return extra > 0 ? `${shown.join(", ")} +${extra}` : shown.join(", ");
  }
  if ((op === "between" || op === "date_between") && Array.isArray(value)) {
    const [a, b] = value as [string | number, string | number];
    return `${a} – ${b}`;
  }
  if (typeof value === "string") return optionLabel(options, value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

export function formatChipLabel(field: FieldDef, condition: FilterCondition, options: FilterOption[]): string {
  if (NO_VALUE_OPS.has(condition.op)) {
    return `${field.label}: ${OPERATOR_LABELS[condition.op]}`;
  }
  const opPrefix = condition.op === "is" ? "" : ` ${OPERATOR_LABELS[condition.op]}`;
  return `${field.label}${opPrefix}: ${formatValue(condition, options)}`;
}

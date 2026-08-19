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

// The one real color already established elsewhere in the app —
// TAG_CLASSES_BY_VALUE's blue-700 (columns-registry.tsx), the exact hex the
// Student tag chip has always used. Every filter chip gets this by default.
//
// A prior attempt at "every field gets a color" (since reverted) invented 6
// new hues grouped into field "families" (identity/people/place/time/origin/
// profile) that meant nothing anywhere else in the app — reverted as
// "fabricated colors." This reuses the one color that's actually real
// instead of inventing more: same technique (light-alpha-tint background +
// tinted border + colored text), one shared color, not six new ones.
export const DEFAULT_CHIP_COLOR = "#1d4ed8";

// Resolves the color for a chip's pill. A condition with EXACTLY ONE selected
// value that carries real per-value color data (a pipeline stage's own
// color, the tag color scheme) uses that real color — genuine information,
// takes priority. Every other case — multi-value selections (an ambiguous
// per-value pick is worse than a shared default; this is not that, it's a
// deliberate fallback, not a blend) and fields with no per-value color
// meaning of their own (Name, Email, City, dates, …) — falls back to the one
// shared DEFAULT_CHIP_COLOR, so every chip is colored, not just Status/Tags.
export function resolveChipColor(condition: FilterCondition, options: FilterOption[]): string {
  const { value } = condition;
  const singleValue = typeof value === "string" ? value : Array.isArray(value) && value.length === 1 ? value[0] : undefined;
  if (singleValue !== undefined) {
    const realColor = options.find((o) => o.value === singleValue)?.color;
    if (realColor) return realColor;
  }
  return DEFAULT_CHIP_COLOR;
}

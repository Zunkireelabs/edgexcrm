"use client";

// The operator + value screen — reached after a field is chosen (either fresh,
// from FilterFieldPicker, or by clicking an existing chip to edit it in place).

import { Button } from "@/components/ui/button";
import type { FieldDef, FilterCondition, FilterOperator, FilterValue } from "@/lib/filters/types";
import type { FilterOption } from "@/components/ui/filter-dropdown";
import { conditionSchema } from "@/lib/filters/schema";
import { FilterOperatorPicker } from "./filter-operator-picker";
import { FilterValueEditor } from "./filter-value-editor";
import { reshapeValueForOperator } from "./condition-defaults";

export interface FilterConditionEditorProps {
  field: FieldDef;
  condition: FilterCondition;
  options: FilterOption[];
  onChange: (condition: FilterCondition) => void;
  onApply: () => void;
}

export function FilterConditionEditor({ field, condition, options, onChange, onApply }: FilterConditionEditorProps) {
  function handleOperatorChange(nextOp: FilterOperator) {
    onChange({ ...condition, op: nextOp, value: reshapeValueForOperator(field, condition.op, nextOp, condition.value) });
  }

  function handleValueChange(nextValue: FilterValue | undefined) {
    onChange({ ...condition, value: nextValue });
  }

  // Same schema the URL round-trip (serialize.ts -> decodeFilterTree) already
  // validates against — reused, not re-derived, so "what Apply allows" and
  // "what actually survives the URL" can never drift apart. Without this, an
  // empty text value / zero-selection multi-select / incomplete date range
  // sails through Apply, then fails validation the moment it round-trips
  // through the URL — and a validation failure resets the WHOLE filter tree,
  // not just this one condition (see use-advanced-filters.ts's degrade path).
  const isValid = conditionSchema.safeParse(condition).success;

  return (
    <div className="flex w-72 flex-col gap-2 p-2">
      <p className="px-1 text-xs font-medium text-muted-foreground">{field.label}</p>
      <FilterOperatorPicker field={field} value={condition.op} onChange={handleOperatorChange} />
      <FilterValueEditor field={field} op={condition.op} value={condition.value} options={options} onChange={handleValueChange} />
      <div className="flex justify-end px-1 pt-1">
        <Button type="button" size="sm" className="h-7 text-xs" onClick={onApply} disabled={!isValid}>
          Apply
        </Button>
      </div>
    </div>
  );
}

"use client";

// The operator + value screen — reached after a field is chosen (either fresh,
// from FilterFieldPicker, or by clicking an existing chip to edit it in place).

import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FieldDef, FilterCondition, FilterOperator, FilterValue } from "@/lib/filters/types";
import type { FilterOption } from "@/components/ui/filter-dropdown";
import { conditionSchema } from "@/lib/filters/schema";
import { FilterOperatorPicker } from "./filter-operator-picker";
import { FilterValueEditor } from "./filter-value-editor";
import { reshapeValueForOperator } from "./condition-defaults";
import { resolvePrefixLabel } from "./chip-label";

export interface FilterConditionEditorProps {
  field: FieldDef;
  condition: FilterCondition;
  options: FilterOption[];
  onChange: (condition: FilterCondition) => void;
  onApply: () => void;
  // Only supplied by the "+ Add filter" flow (AddFilterButton), which has an
  // actual field list to return to. Editing an existing chip (FilterChip)
  // never passes this — there's no list to go back to from there, the field
  // is already fixed. When present, the field label becomes a clickable
  // "‹ Field" back-navigation header instead of plain text.
  onBack?: () => void;
}

export function FilterConditionEditor({ field, condition, options, onChange, onApply, onBack }: FilterConditionEditorProps) {
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
  // Same per-value prefix used by the chip itself (resolvePrefixLabel) — so
  // reopening a "Leads Organize: New Leads (Unrouted)" chip shows that same
  // heading here, not the shared field's generic "Stage" label. Falls back to
  // field.label whenever the option carries no groupLabel (every field except
  // the email-blast composer's Stage/Leads Organize/Archive/Delete split).
  const headingLabel = resolvePrefixLabel(field, condition, options);

  return (
    <div className="flex w-72 flex-col gap-2 p-2">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 self-start px-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" />
          {headingLabel}
        </button>
      ) : (
        <p className="px-1 text-xs font-medium text-muted-foreground">{headingLabel}</p>
      )}
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

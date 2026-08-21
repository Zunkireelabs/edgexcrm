"use client";

// "+ Add filter" — opens a popover that starts on FilterFieldPicker, then
// swaps to FilterConditionEditor once a field is chosen. The new condition
// only lands in the tree when "Apply" is pressed (or the popover closes with
// a field chosen but not yet applied — in that case it's discarded, matching
// Notion/Twenty: closing an unfinished "+ Add filter" adds nothing).

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { FieldDef, FilterCondition } from "@/lib/filters/types";
import { FilterFieldPicker } from "./filter-field-picker";
import { FilterConditionEditor } from "./filter-condition-editor";
import { newConditionForField } from "./condition-defaults";
import type { FilterOption } from "./types";

export interface AddFilterButtonProps {
  fields: FieldDef[];
  getOptions: (field: FieldDef) => FilterOption[];
  onAdd: (condition: FilterCondition) => void;
  disabled?: boolean;
  compact?: boolean;
  onDraftConditionChange?: (condition: FilterCondition | null) => void;
}

export function AddFilterButton({ fields, getOptions, onAdd, disabled, compact, onDraftConditionChange }: AddFilterButtonProps) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<{ field: FieldDef; condition: FilterCondition } | null>(null);

  useEffect(() => {
    onDraftConditionChange?.(picked?.condition ?? null);
  }, [picked, onDraftConditionChange]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setPicked(null); // discard an unfinished pick on close
  }

  function handleFieldSelect(field: FieldDef) {
    setPicked({ field, condition: newConditionForField(field) });
  }

  function handleBack() {
    setPicked(null);
  }

  function handleApply() {
    if (!picked) return;
    onAdd(picked.condition);
    setOpen(false);
    setPicked(null);
  }

  void compact; // reserved for `density` styling in a later phase; button text/size stays constant for now

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          data-testid="add-filter-button"
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        >
          <Plus className="size-3.5" />
          Add filter
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        {picked ? (
          <FilterConditionEditor
            field={picked.field}
            condition={picked.condition}
            options={getOptions(picked.field)}
            onChange={(next) => setPicked({ field: picked.field, condition: next })}
            onApply={handleApply}
            onBack={handleBack}
          />
        ) : (
          <FilterFieldPicker fields={fields} onSelect={handleFieldSelect} />
        )}
      </PopoverContent>
    </Popover>
  );
}

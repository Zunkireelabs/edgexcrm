"use client";

// A single "Name: brian ✕" pill. Clicking the label re-opens the exact same
// FilterConditionEditor used by AddFilterButton, pre-filled — editing a chip
// in place is the same screen as creating one, just seeded differently.

import { useState } from "react";
import { X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { FieldDef, FilterCondition } from "@/lib/filters/types";
import { FilterConditionEditor } from "./filter-condition-editor";
import { formatChipLabel, resolveChipColor } from "./chip-label";
import type { FilterOption } from "./types";

export interface FilterChipProps {
  field: FieldDef;
  condition: FilterCondition;
  options: FilterOption[];
  onChange: (condition: FilterCondition) => void;
  onRemove: () => void;
}

export function FilterChip({ field, condition, options, onChange, onRemove }: FilterChipProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(condition);

  function handleOpenChange(next: boolean) {
    if (next) setDraft(condition); // re-seed from the committed value each time it opens
    setOpen(next);
  }

  function handleApply() {
    onChange(draft);
    setOpen(false);
  }

  // Same tinted-background/colored-text/tinted-border technique already used
  // for stage badges elsewhere in the app (columns-registry.tsx) — reusing
  // one real color, not inventing a new palette.
  const color = resolveChipColor(condition, options);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <div
        className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-md border pl-2.5 pr-1 text-xs ${color ? "" : "border-input bg-background"}`}
        style={color ? { backgroundColor: `${color}20`, borderColor: `${color}66` } : undefined}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="filter-chip"
            className={`font-medium hover:underline ${color ? "" : "text-foreground"}`}
            style={color ? { color } : undefined}
          >
            {formatChipLabel(field, condition, options)}
          </button>
        </PopoverTrigger>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${field.label} filter`}
          className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      </div>
      <PopoverContent align="start" className="w-auto p-0">
        <FilterConditionEditor field={field} condition={draft} options={options} onChange={setDraft} onApply={handleApply} />
      </PopoverContent>
    </Popover>
  );
}

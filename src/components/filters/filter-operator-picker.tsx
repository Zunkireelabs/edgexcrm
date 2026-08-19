"use client";

// Operator dropdown — options come strictly from isOperatorAllowed() /
// operatorsForField(), never a hand-maintained list, so the UI can never
// offer an operator the compiler would 422 (e.g. is_none_of on a relation).

import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import type { FieldDef, FilterOperator } from "@/lib/filters/types";
import { operatorsForField } from "@/lib/filters/operators";
import { OPERATOR_LABELS } from "./condition-defaults";

export interface FilterOperatorPickerProps {
  field: FieldDef;
  value: FilterOperator;
  onChange: (op: FilterOperator) => void;
}

export function FilterOperatorPicker({ field, value, onChange }: FilterOperatorPickerProps) {
  const operators = operatorsForField(field);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="filter-operator-trigger"
          className="inline-flex h-8 min-w-28 shrink-0 items-center justify-between gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs font-medium text-foreground outline-none"
        >
          <span>{OPERATOR_LABELS[value]}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      {/* Fixed width sized for the longest label ("greater than or equal to",
          25 chars) — NOT matched to the trigger's own width, since the
          trigger can be showing a short current value ("is") while the list
          still needs room for every operator, not just the selected one. */}
      <PopoverContent align="start" className="w-52 p-0">
        <Command>
          <CommandList>
            <CommandGroup>
              {operators.map((op) => (
                <CommandItem
                  key={op}
                  value={OPERATOR_LABELS[op]}
                  onSelect={() => onChange(op)}
                  className="px-2 py-1 text-xs"
                >
                  <Check className={cn("size-3", value === op ? "opacity-100" : "opacity-0")} />
                  <span>{OPERATOR_LABELS[op]}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

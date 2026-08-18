"use client";

// The "+ Add filter" popover's first screen — pick which field to filter on.
// Grouped by FieldDef.group ("Basic", "Dates", "Education", …), searchable.
// This is popover CONTENT (rendered inside AddFilterButton's Popover), not a
// second nested trigger — matches reference screenshot 1.

import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import type { FieldDef } from "@/lib/filters/types";

export interface FilterFieldPickerProps {
  fields: FieldDef[];
  onSelect: (field: FieldDef) => void;
}

function groupFields(fields: FieldDef[]): [string, FieldDef[]][] {
  const groups = new Map<string, FieldDef[]>();
  for (const field of fields) {
    const list = groups.get(field.group) ?? [];
    list.push(field);
    groups.set(field.group, list);
  }
  return Array.from(groups.entries());
}

export function FilterFieldPicker({ fields, onSelect }: FilterFieldPickerProps) {
  const filterable = fields.filter((f) => f.filterable && !f.hiddenFromPicker);
  const grouped = groupFields(filterable);

  return (
    // w-72 matches FilterConditionEditor's own width (the next screen), so the
    // "+ Add filter" popover doesn't visibly resize between picking a field
    // and picking its operator/value.
    <Command className="w-72">
      <CommandInput placeholder="Filter by…" className="text-xs" />
      <CommandList>
        {/* CommandEmpty doesn't merge className via cn() like its siblings — it
            spreads props after a hardcoded className, so this REPLACES the
            default entirely rather than extending it. Re-including
            text-center so this doesn't silently left-align as a side effect. */}
        <CommandEmpty className="py-4 text-center text-xs">No matching fields.</CommandEmpty>
        {grouped.map(([group, groupFields]) => (
          <CommandGroup key={group} heading={group}>
            {groupFields.map((field) => (
              <CommandItem
                key={field.key}
                value={`${field.label} ${field.key}`}
                onSelect={() => onSelect(field)}
                className="px-2 py-1 text-xs"
              >
                {field.label}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  );
}

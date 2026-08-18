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
    <Command>
      <CommandInput placeholder="Filter by…" />
      <CommandList>
        <CommandEmpty>No matching fields.</CommandEmpty>
        {grouped.map(([group, groupFields]) => (
          <CommandGroup key={group} heading={group}>
            {groupFields.map((field) => (
              <CommandItem key={field.key} value={`${field.label} ${field.key}`} onSelect={() => onSelect(field)}>
                {field.label}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  );
}

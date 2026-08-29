"use client";

// The "+ Add filter" popover's first screen — pick which field to filter on.
// Grouped by FieldDef.group ("Basic", "Dates", "Education", …), searchable.
// This is popover CONTENT (rendered inside AddFilterButton's Popover), not a
// second nested trigger — matches reference screenshot 1.

import { ChevronRight } from "lucide-react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { FieldDef } from "@/lib/filters/types";
import type { HierarchicalFieldGroups, OptionLoaderKey } from "./types";

export interface FilterFieldPickerProps {
  fields: FieldDef[];
  onSelect: (field: FieldDef) => void;
  /** Opt-in nested groups for specific field keys — see HierarchicalFieldGroups.
   *  When a field key has an entry here, that field's normal flat CommandItem
   *  row is replaced by its "Leads Organize" / "Stage→Status" tree; every
   *  other field renders exactly as before. Undefined (SMS composer,
   *  leads-table) => fully unchanged flat rendering. */
  hierarchicalGroups?: Partial<Record<OptionLoaderKey, HierarchicalFieldGroups>>;
  /** Bare leaf pick (a Leads Organize item, or a Stage clicked without
   *  expanding) — commits a single condition directly, skipping the
   *  operator/value editor screen. */
  onSelectLeaf?: (field: FieldDef, value: string) => void;
  /** Status leaf picked under an expanded Stage node — commits two
   *  conditions (stage + status) in one Apply. `statusField` is resolved by
   *  the caller (looked up from `fields` by key "status"). */
  onSelectStageStatus?: (stageField: FieldDef, stageValue: string, statusField: FieldDef, statusValue: string) => void;
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

export function FilterFieldPicker({ fields, onSelect, hierarchicalGroups, onSelectLeaf, onSelectStageStatus }: FilterFieldPickerProps) {
  const filterable = fields.filter((f) => f.filterable && !f.hiddenFromPicker);
  const hierarchicalFields = filterable.filter((f) => hierarchicalGroups?.[f.key]);
  // When a hierarchical stage group has status leaves nested under it, drop
  // the flat "Status" row so it isn't offered twice — scoped to hierarchy
  // being active, so SMS composer / leads-table (no hierarchicalGroups) keep
  // showing Status under BASIC exactly as today.
  const hasNestedStatus = hierarchicalFields.some((f) => (hierarchicalGroups?.[f.key]?.stages.length ?? 0) > 0);
  const flatFields = filterable.filter((f) => !hierarchicalGroups?.[f.key] && !(hasNestedStatus && f.key === "status"));
  const grouped = groupFields(flatFields);
  const statusField = fields.find((f) => f.key === "status");

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
        {hierarchicalFields.map((field) => {
          const groups = hierarchicalGroups?.[field.key];
          if (!groups) return null;
          return (
            <CommandGroup
              key={field.key}
              heading="Leads"
              className="[&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide"
            >
              {groups.orgLists.length > 0 && (
                <Collapsible>
                  <CollapsibleTrigger className="flex w-full items-center gap-1 px-2 py-1 text-xs font-medium text-foreground [&[data-state=open]>svg]:rotate-90">
                    <ChevronRight className="size-3 shrink-0 transition-transform" />
                    Leads Organize
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pl-4">
                    {groups.orgLists.map((leaf) => (
                      <CommandItem
                        key={leaf.value}
                        value={`${field.label} organize ${leaf.label}`}
                        onSelect={() => onSelectLeaf?.(field, leaf.value)}
                        className="px-2 py-1 text-xs"
                      >
                        {leaf.label}
                      </CommandItem>
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              )}
              {groups.stages.length > 0 && (
                <Collapsible>
                  <CollapsibleTrigger className="flex w-full items-center gap-1 px-2 py-1 text-xs font-medium text-foreground [&[data-state=open]>svg]:rotate-90">
                    <ChevronRight className="size-3 shrink-0 transition-transform" />
                    Stage
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pl-4">
                    {groups.stages.map((stage) => (
                      <Collapsible key={stage.value}>
                        <div className="flex items-center">
                          <CommandItem
                            value={`${field.label} stage ${stage.label}`}
                            onSelect={() => onSelectLeaf?.(field, stage.value)}
                            className="flex-1 px-2 py-1 text-xs"
                          >
                            {stage.label}
                          </CommandItem>
                          {stage.statusOptions.length > 0 && (
                            <CollapsibleTrigger className="px-1 py-1 text-muted-foreground [&[data-state=open]>svg]:rotate-90">
                              <ChevronRight className="size-3 transition-transform" />
                            </CollapsibleTrigger>
                          )}
                        </div>
                        {stage.statusOptions.length > 0 && (
                          <CollapsibleContent className="pl-4">
                            {stage.statusOptions.map((status) => (
                              <CommandItem
                                key={status.value}
                                value={`${field.label} stage ${stage.label} status ${status.label}`}
                                onSelect={() => statusField && onSelectStageStatus?.(field, stage.value, statusField, status.value)}
                                className="px-2 py-1 text-xs"
                              >
                                {status.label}
                              </CommandItem>
                            ))}
                          </CollapsibleContent>
                        )}
                      </Collapsible>
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              )}
              {groups.archive && (
                <CommandItem
                  value={`${field.label} archive ${groups.archive.label}`}
                  onSelect={() => onSelectLeaf?.(field, groups.archive!.value)}
                  className="px-2 py-1 text-xs"
                >
                  Archive
                </CommandItem>
              )}
              {groups.deleteList && (
                <CommandItem
                  value={`${field.label} delete ${groups.deleteList.label}`}
                  onSelect={() => onSelectLeaf?.(field, groups.deleteList!.value)}
                  className="px-2 py-1 text-xs"
                >
                  Delete
                </CommandItem>
              )}
            </CommandGroup>
          );
        })}
        {grouped.map(([group, groupFields]) => (
          // The default group-heading style (from the shared Command base)
          // barely differs from a regular row — same size, only slightly
          // muted — so "Basic"/"Dates"/"Education" read as just more list
          // items instead of section labels. Strengthened here, scoped to
          // this picker only: uppercase + letter-spacing is an unambiguous
          // "this is a category, not a click target" signal, bolder weight,
          // and extra top padding so it visually detaches from the previous
          // group's last row instead of running straight into it.
          <CommandGroup
            key={group}
            heading={group}
            className="[&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide"
          >
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

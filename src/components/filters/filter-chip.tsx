"use client";

// A single "Name: brian ✕" pill. Clicking the label re-opens a two-screen
// popover: the operator/value editor (seeded from the committed condition),
// with a "‹ back" arrow to the field/category picker — the same
// FilterFieldPicker "+ Add filter" starts on. Re-picking there rewrites THIS
// chip in place (same condition id, same row position), so switching a chip
// from e.g. "Stage" to "Leads Organize" no longer means delete-and-re-add.

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { FieldDef, FilterCondition } from "@/lib/filters/types";
import { FilterConditionEditor } from "./filter-condition-editor";
import { FilterFieldPicker } from "./filter-field-picker";
import { formatChipLabel, resolveChipColor, scopeOptionsToConditionGroup } from "./chip-label";
import { newConditionForField, defaultOperatorForField } from "./condition-defaults";
import type { FilterOption, HierarchicalFieldGroups, OptionLoaderKey } from "./types";

export interface FilterChipProps {
  field: FieldDef;
  condition: FilterCondition;
  /** Resolves the option list for any field — needed (not just a static
   *  `options` array) because the back-arrow flow can re-point this chip at a
   *  different field, whose options must then be looked up. */
  getOptions: (field: FieldDef) => FilterOption[];
  /** Every filterable field, for the back-arrow picker screen. */
  fields: FieldDef[];
  /** Same nested-picker override AddFilterButton gets — the chip picker
   *  reuses it so "Stage / Leads Organize / Archive / Delete" is re-pickable
   *  here too. Absent everywhere except the email-campaigns composer. */
  hierarchicalGroups?: Partial<Record<OptionLoaderKey, HierarchicalFieldGroups>>;
  onChange: (condition: FilterCondition) => void;
  onRemove: () => void;
  onDraftConditionChange?: (condition: FilterCondition | null) => void;
}

type Screen = "editor" | "picker";

export function FilterChip({
  field,
  condition,
  getOptions,
  fields,
  hierarchicalGroups,
  onChange,
  onRemove,
  onDraftConditionChange,
}: FilterChipProps) {
  const [open, setOpen] = useState(false);
  const [screen, setScreen] = useState<Screen>("editor");
  const [draft, setDraft] = useState(condition);
  const [draftField, setDraftField] = useState(field);

  useEffect(() => {
    onDraftConditionChange?.(open && screen === "editor" ? draft : null);
  }, [draft, open, screen, onDraftConditionChange]);

  function handleOpenChange(next: boolean) {
    if (next) {
      // re-seed from the committed value each time it opens
      setDraft(condition);
      setDraftField(field);
      setScreen("editor");
    }
    setOpen(next);
  }

  function handleApply() {
    onChange(draft);
    setOpen(false);
  }

  function commitLeaf(pickedField: FieldDef, value: string) {
    onChange({ id: condition.id, field: pickedField.key, op: defaultOperatorForField(pickedField), value });
    setOpen(false);
  }

  function pickField(pickedField: FieldDef) {
    // keep the chip's id + row position; everything else is fresh for the new field
    setDraft({ ...newConditionForField(pickedField), id: condition.id });
    setDraftField(pickedField);
    setScreen("editor");
  }

  // Committed-value view (chip label + color) always uses the committed
  // field's full option list — never the group-scoped subset.
  const displayOptions = useMemo(() => getOptions(field), [getOptions, field]);
  const color = resolveChipColor(condition, displayOptions);

  // Editor screen: options for whatever field the draft currently points at,
  // narrowed to the draft value's own category so a reopened "Leads Organize"
  // chip lists only Leads Organize lists.
  const editorOptions = useMemo(
    () => scopeOptionsToConditionGroup(draft, getOptions(draftField)),
    [draft, getOptions, draftField],
  );

  // Picker screen reuses AddFilterButton's grouping, minus the Stage→Status
  // sub-expansion (a chip edit can only yield one condition, and the flat
  // "Status" field row stays available instead — see FilterFieldPicker's
  // hasNestedStatus).
  const pickerGroups = useMemo(() => {
    if (!hierarchicalGroups) return undefined;
    const out: Partial<Record<OptionLoaderKey, HierarchicalFieldGroups>> = {};
    for (const [key, groups] of Object.entries(hierarchicalGroups)) {
      if (!groups) continue;
      out[key] = { ...groups, stages: groups.stages.map((s) => ({ ...s, statusOptions: [] })) };
    }
    return out;
  }, [hierarchicalGroups]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <div
        // rounded-[4px] matches the Tag pill and Stage badge elsewhere in the
        // app exactly (columns-registry.tsx, stage-selector.tsx) — not rounded-md.
        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[4px] border pl-2.5 pr-1 text-xs"
        style={{ backgroundColor: `${color}20`, borderColor: `${color}66` }}
      >
        <PopoverTrigger asChild>
          <button type="button" data-testid="filter-chip" className="font-medium hover:underline" style={{ color }}>
            {formatChipLabel(field, condition, displayOptions)}
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
        {screen === "picker" ? (
          <FilterFieldPicker
            fields={fields}
            onSelect={pickField}
            hierarchicalGroups={pickerGroups}
            onSelectLeaf={commitLeaf}
            // Chip edits yield one condition; a bare stage pick is the sensible
            // outcome. (statusOptions are stripped from pickerGroups, so
            // FilterFieldPicker never actually renders a status sub-leaf here.)
            onSelectStageStatus={(stageField, stageValue) => commitLeaf(stageField, stageValue)}
          />
        ) : (
          <FilterConditionEditor
            field={draftField}
            condition={draft}
            options={editorOptions}
            onChange={setDraft}
            onApply={handleApply}
            onBack={() => setScreen("picker")}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

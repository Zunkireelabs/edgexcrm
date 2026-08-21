"use client";

// The Notion/Twenty-style filter bar. Reads/writes only `value`/`onChange` —
// state (URL sync, decode-degrade) is the host's job via use-advanced-filters;
// this component is a pure controlled tree editor so it can serve table,
// kanban and board (Phase 4) with zero surface-specific branches inside it.

import type { FieldDef, FilterCondition } from "@/lib/filters/types";
import { FilterChipRow } from "./filter-chip-row";
import { ConjunctionToggle } from "./conjunction-toggle";
import { AddFilterButton } from "./add-filter-button";
import { useFilterOptions } from "./use-filter-options";
import { addOrMergeCondition } from "./condition-defaults";
import type { FilterHostConfig } from "./types";

export const DEFAULT_MAX_CONDITIONS = 25;

export function AdvancedFilterBar({
  fields,
  value,
  onChange,
  showChips = true,
  maxConditions = DEFAULT_MAX_CONDITIONS,
  optionOverrides,
  hideAddButton = false,
  onDraftConditionChange,
}: FilterHostConfig) {
  const { getOptions } = useFilterOptions(optionOverrides);

  const registry: Record<string, FieldDef> = {};
  for (const field of fields) registry[field.key] = field;

  const conditions = value.conditions;
  const atCap = conditions.length >= maxConditions;

  function handleAdd(condition: FilterCondition) {
    onChange({ ...value, conditions: addOrMergeCondition(value.conditions, condition) });
  }

  function handleChangeCondition(id: string, next: FilterCondition) {
    onChange({ ...value, conditions: value.conditions.map((c) => (c.id === id ? next : c)) });
  }

  function handleRemoveCondition(id: string) {
    onChange({ ...value, conditions: value.conditions.filter((c) => c.id !== id) });
  }

  function handleConjunctionChange(conjunction: "and" | "or") {
    onChange({ ...value, conjunction });
  }

  function handleClearAll() {
    onChange({ conjunction: "and", conditions: [] });
  }

  // groups[] has no UI path to populate today (allowGroups isn't wired up
  // anywhere yet), but checking it here too costs nothing and means this
  // doesn't need revisiting the day it does.
  const hasAnything = conditions.length > 0 || (value.groups?.length ?? 0) > 0;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {showChips && conditions.length > 1 && <ConjunctionToggle value={value.conjunction} onChange={handleConjunctionChange} />}
      {showChips && (
        <FilterChipRow
          conditions={conditions}
          registry={registry}
          getOptions={getOptions}
          onChangeCondition={handleChangeCondition}
          onRemoveCondition={handleRemoveCondition}
          onDraftConditionChange={onDraftConditionChange}
        />
      )}
      {!hideAddButton && (
        <AddFilterButton
          fields={fields}
          getOptions={getOptions}
          onAdd={handleAdd}
          disabled={atCap}
          onDraftConditionChange={onDraftConditionChange}
        />
      )}
      {showChips && hasAnything && (
        <button
          type="button"
          onClick={handleClearAll}
          className="text-[11px] text-muted-foreground underline hover:text-foreground"
        >
          Clear all
        </button>
      )}
    </div>
  );
}

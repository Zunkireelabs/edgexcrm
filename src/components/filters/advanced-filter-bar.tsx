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
import { addOrMergeCondition, applyConditionChange } from "./condition-defaults";
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
  hierarchicalGroups,
}: FilterHostConfig) {
  const { getOptions } = useFilterOptions(optionOverrides);

  const registry: Record<string, FieldDef> = {};
  for (const field of fields) registry[field.key] = field;

  const conditions = value.conditions;
  const atCap = conditions.length >= maxConditions;

  function handleAdd(condition: FilterCondition) {
    onChange({ ...value, conditions: addOrMergeCondition(value.conditions, condition) });
  }

  function handleAddMany(conditions: FilterCondition[]) {
    onChange({ ...value, conditions: conditions.reduce((acc, c) => addOrMergeCondition(acc, c), value.conditions) });
  }

  function handleChangeCondition(id: string, next: FilterCondition) {
    // A chip's back-arrow re-pick can re-point it at a field another chip
    // already filters — which must de-dupe (two "field is A" / "field is B"
    // AND to zero rows). applyConditionChange folds the sibling into the
    // edited chip in its own row slot; the common case (value/operator edit,
    // or switching to an unused field) is a plain position-preserving replace.
    onChange({ ...value, conditions: applyConditionChange(value.conditions, id, next) });
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
          fields={fields}
          hierarchicalGroups={hierarchicalGroups}
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
          onAddMany={handleAddMany}
          disabled={atCap}
          onDraftConditionChange={onDraftConditionChange}
          hierarchicalGroups={hierarchicalGroups}
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

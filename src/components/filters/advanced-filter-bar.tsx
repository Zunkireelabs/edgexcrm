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
import type { FilterHostConfig } from "./types";

const DEFAULT_MAX_CONDITIONS = 25;

export function AdvancedFilterBar({
  fields,
  value,
  onChange,
  showChips = true,
  maxConditions = DEFAULT_MAX_CONDITIONS,
  optionOverrides,
}: FilterHostConfig) {
  const { getOptions } = useFilterOptions(optionOverrides);

  const registry: Record<string, FieldDef> = {};
  for (const field of fields) registry[field.key] = field;

  const conditions = value.conditions;
  const atCap = conditions.length >= maxConditions;

  function handleAdd(condition: FilterCondition) {
    onChange({ ...value, conditions: [...value.conditions, condition] });
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
        />
      )}
      <AddFilterButton
        fields={fields}
        getOptions={getOptions}
        onAdd={handleAdd}
        disabled={atCap}
      />
    </div>
  );
}

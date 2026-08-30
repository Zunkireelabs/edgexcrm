"use client";

import type { FieldDef, FilterCondition } from "@/lib/filters/types";
import { FilterChip } from "./filter-chip";
import type { FilterOption, HierarchicalFieldGroups, OptionLoaderKey } from "./types";

export interface FilterChipRowProps {
  conditions: FilterCondition[];
  registry: Record<string, FieldDef>;
  getOptions: (field: FieldDef) => FilterOption[];
  /** All filterable fields — forwarded to each chip's back-arrow picker. */
  fields: FieldDef[];
  hierarchicalGroups?: Partial<Record<OptionLoaderKey, HierarchicalFieldGroups>>;
  onChangeCondition: (id: string, next: FilterCondition) => void;
  onRemoveCondition: (id: string) => void;
  onDraftConditionChange?: (condition: FilterCondition | null) => void;
}

export function FilterChipRow({
  conditions,
  registry,
  getOptions,
  fields,
  hierarchicalGroups,
  onChangeCondition,
  onRemoveCondition,
  onDraftConditionChange,
}: FilterChipRowProps) {
  return (
    <>
      {conditions.map((condition) => {
        const field = registry[condition.field];
        if (!field) return null; // stale/unknown field key — dropped silently, matches use-advanced-filters' degrade-on-decode contract
        return (
          <FilterChip
            key={condition.id}
            field={field}
            condition={condition}
            getOptions={getOptions}
            fields={fields}
            hierarchicalGroups={hierarchicalGroups}
            onChange={(next) => onChangeCondition(condition.id, next)}
            onRemove={() => onRemoveCondition(condition.id)}
            onDraftConditionChange={onDraftConditionChange}
          />
        );
      })}
    </>
  );
}

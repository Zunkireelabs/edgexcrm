"use client";

import type { FieldDef, FilterCondition } from "@/lib/filters/types";
import { FilterChip } from "./filter-chip";
import type { FilterOption } from "./types";

export interface FilterChipRowProps {
  conditions: FilterCondition[];
  registry: Record<string, FieldDef>;
  getOptions: (field: FieldDef) => FilterOption[];
  onChangeCondition: (id: string, next: FilterCondition) => void;
  onRemoveCondition: (id: string) => void;
}

export function FilterChipRow({ conditions, registry, getOptions, onChangeCondition, onRemoveCondition }: FilterChipRowProps) {
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
            options={getOptions(field)}
            onChange={(next) => onChangeCondition(condition.id, next)}
            onRemove={() => onRemoveCondition(condition.id)}
          />
        );
      })}
    </>
  );
}

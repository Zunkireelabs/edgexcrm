"use client";

import { useState } from "react";
import { ChevronLeft, SlidersHorizontal, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { FilterOptionList, type FilterOption } from "./filter-dropdown";

export interface FilterDef {
  id: string;
  label: string;
  icon?: React.ReactNode;
  multiple?: boolean;
  searchable?: boolean;
  options: FilterOption[];
  value: string | string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- FilterDef[] mixes single/multi value shapes
  onChange: (value: any) => void;
  defaultValue?: string;
}

export interface FilterMenuProps {
  filters: FilterDef[];
  activeCount: number;
  onClearAll: () => void;
}

function isFilterActive(filter: FilterDef): boolean {
  if (filter.multiple) {
    return (filter.value as string[]).length > 0;
  }
  const single = filter.value as string;
  const defaultValue = filter.defaultValue ?? "all";
  return single !== defaultValue && single !== "__all__";
}

function filterSummary(filter: FilterDef): string {
  if (filter.multiple) {
    const selected = filter.value as string[];
    if (selected.length === 0) return filter.label;
    if (selected.length === 1) {
      const opt = filter.options.find((o) => o.value === selected[0]);
      return `${filter.label}: ${opt?.label ?? selected[0]}`;
    }
    return `${filter.label} (${selected.length})`;
  }
  const single = filter.value as string;
  const selectedOption = filter.options.find((o) => o.value === single);
  return selectedOption?.label ? `${filter.label}: ${selectedOption.label}` : filter.label;
}

function clearFilter(filter: FilterDef) {
  if (filter.multiple) {
    filter.onChange([]);
  } else {
    filter.onChange(filter.defaultValue ?? "all");
  }
}

export function FilterMenu({ filters, activeCount, onClearAll }: FilterMenuProps) {
  const [open, setOpen] = useState(false);
  const [drilledId, setDrilledId] = useState<string | null>(null);

  const drilledFilter = filters.find((f) => f.id === drilledId) ?? null;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setDrilledId(null);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded-md border transition-colors ${
            activeCount > 0
              ? "border-[#0f0f10] bg-[#0000170b] text-[#0f0f10]"
              : "border-gray-300 bg-white text-gray-600 hover:bg-[#0000170b]"
          }`}
        >
          <SlidersHorizontal className="h-3 w-3 shrink-0" />
          Filters
          {activeCount > 0 && (
            <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-[#0f0f10] text-white text-[10px] leading-none">
              {activeCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-64 p-0 bg-white rounded-lg shadow-lg border border-gray-200 z-50"
      >
        {!drilledFilter ? (
          <>
            <div className="px-3 py-2 border-b border-gray-100">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Filter by
              </span>
            </div>
            <div className="py-1 max-h-72 overflow-y-auto">
              {filters.map((filter) => {
                const active = isFilterActive(filter);
                return (
                  <button
                    key={filter.id}
                    type="button"
                    onClick={() => setDrilledId(filter.id)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors hover:bg-[#0000170b]"
                  >
                    {filter.icon && (
                      <span className="shrink-0 text-gray-500">{filter.icon}</span>
                    )}
                    <span className="flex-1 min-w-0 truncate text-[#0f0f10]">
                      {filter.label}
                    </span>
                    {active && (
                      <span className="shrink-0 max-w-[110px] truncate text-[11px] text-muted-foreground">
                        {filterSummary(filter)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {activeCount > 0 && (
              <div className="border-t border-gray-100 py-1">
                <button
                  type="button"
                  onClick={() => {
                    onClearAll();
                    setOpen(false);
                    setDrilledId(null);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-red-600 transition-colors hover:bg-red-50"
                >
                  <X className="h-3 w-3 shrink-0" />
                  Clear all filters
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setDrilledId(null)}
              className="w-full flex items-center gap-1.5 px-3 py-2 text-left text-xs font-medium text-[#0f0f10] border-b border-gray-100 hover:bg-[#0000170b]"
            >
              <ChevronLeft className="h-3.5 w-3.5 shrink-0" />
              {drilledFilter.label}
            </button>
            <FilterOptionList
              options={drilledFilter.options}
              multiple={drilledFilter.multiple === true}
              value={drilledFilter.value}
              searchable={drilledFilter.searchable ?? true}
              onSelectSingle={(v) => {
                drilledFilter.onChange(v);
                setDrilledId(null);
              }}
              onSelectMulti={(v) => {
                const current = drilledFilter.value as string[];
                const next = current.includes(v)
                  ? current.filter((x) => x !== v)
                  : [...current, v];
                drilledFilter.onChange(next);
              }}
              onClearMulti={() => drilledFilter.onChange([])}
            />
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function FilterChips({ filters, onClearAll }: { filters: FilterDef[]; onClearAll: () => void }) {
  const active = filters.filter(isFilterActive);
  if (active.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
      {active.map((filter) => (
        <span
          key={filter.id}
          className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-[#0f0f10] bg-[#0000170b] text-[11px] text-[#0f0f10]"
        >
          {filterSummary(filter)}
          <button
            type="button"
            onClick={() => clearFilter(filter)}
            className="shrink-0 hover:opacity-70"
            aria-label={`Clear ${filter.label} filter`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="text-[11px] text-muted-foreground hover:text-foreground underline"
      >
        Clear all
      </button>
    </div>
  );
}

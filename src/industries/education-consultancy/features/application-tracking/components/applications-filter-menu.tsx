"use client";

import { useState } from "react";
import { ChevronLeft, SlidersHorizontal, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { FilterOptionList, type FilterOption } from "@/components/ui/filter-dropdown";

export type ApplicationsFilterField =
  | {
      id: string;
      label: string;
      multiple?: false;
      value: string;
      onChange: (value: string) => void;
      options: FilterOption[];
      searchable?: boolean;
    }
  | {
      id: string;
      label: string;
      multiple: true;
      value: string[];
      onChange: (value: string[]) => void;
      options: FilterOption[];
      searchable?: boolean;
    };

interface ApplicationsFilterMenuProps {
  fields: ApplicationsFilterField[];
  activeCount: number;
  onClearAll: () => void;
}

function isFieldActive(field: ApplicationsFilterField): boolean {
  return field.multiple ? field.value.length > 0 : field.value !== "all";
}

function fieldSummary(field: ApplicationsFilterField): string {
  if (field.multiple) {
    const selected = field.value;
    if (selected.length === 0) return field.label;
    if (selected.length === 1) {
      const opt = field.options.find((o) => o.value === selected[0]);
      return opt?.label ?? field.label;
    }
    return `${field.label} (${selected.length})`;
  }
  const opt = field.options.find((o) => o.value === field.value);
  return opt?.label && isFieldActive(field) ? opt.label : field.label;
}

/** Applications-only Filters button — Stage + Country. Deliberately not shared
 * with Leads' FilterMenu so the two pages can never affect each other. */
export function ApplicationsFilterMenu({ fields, activeCount, onClearAll }: ApplicationsFilterMenuProps) {
  const [open, setOpen] = useState(false);
  const [drilledId, setDrilledId] = useState<string | null>(null);

  const drilled = fields.find((f) => f.id === drilledId) ?? null;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setDrilledId(null);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded-[8px] border transition-colors ${
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
      <PopoverContent align="end" className="w-64 p-0 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
        {!drilled ? (
          <>
            <div className="px-3 py-2 border-b border-gray-100">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Filter by
              </span>
            </div>
            <div className="py-1">
              {fields.map((field) => (
                <button
                  key={field.id}
                  type="button"
                  onClick={() => setDrilledId(field.id)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors hover:bg-[#0000170b]"
                >
                  <span className="flex-1 min-w-0 truncate text-[#0f0f10]">{field.label}</span>
                  {isFieldActive(field) && (
                    <span className="shrink-0 max-w-[110px] truncate text-[11px] text-muted-foreground">
                      {fieldSummary(field)}
                    </span>
                  )}
                </button>
              ))}
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
              {drilled.label}
            </button>
            {drilled.multiple ? (
              <FilterOptionList
                options={drilled.options}
                multiple
                value={drilled.value}
                searchable={drilled.searchable ?? true}
                onSelectSingle={() => {}}
                onSelectMulti={(v) => {
                  const current = drilled.value;
                  drilled.onChange(
                    current.includes(v) ? current.filter((x) => x !== v) : [...current, v],
                  );
                }}
                onClearMulti={() => drilled.onChange([])}
              />
            ) : (
              <FilterOptionList
                options={drilled.options}
                multiple={false}
                value={drilled.value}
                searchable={drilled.searchable ?? true}
                onSelectSingle={(v) => {
                  drilled.onChange(v);
                  setDrilledId(null);
                }}
                onSelectMulti={() => {}}
              />
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Active-filter chips row shown below the toolbar — Applications-only, mirrors
 * the visual language of Leads' FilterChips without sharing its code. */
export function ApplicationsFilterChips({
  fields,
  onClearAll,
}: {
  fields: ApplicationsFilterField[];
  onClearAll: () => void;
}) {
  const active = fields.filter(isFieldActive);
  if (active.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
      {active.map((field) => (
        <span
          key={field.id}
          className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-[#0f0f10] bg-[#0000170b] text-[11px] text-[#0f0f10]"
        >
          {fieldSummary(field)}
          <button
            type="button"
            onClick={() => (field.multiple ? field.onChange([]) : field.onChange("all"))}
            className="shrink-0 hover:opacity-70"
            aria-label={`Clear ${field.label} filter`}
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

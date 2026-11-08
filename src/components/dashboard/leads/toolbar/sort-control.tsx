"use client";

// Sort: a quiet "Sorted by <field>" chip that opens a one-level popover — field picker, direction
// picker, remove (back to the default sort) — per the mockup's Sort popover. The second level and
// "Add sort" are NOT built: the leads API takes a single sort key (EDGEX-120 will add multi-level).

import { useState } from "react";
import { ArrowsDownUpIcon, CaretDownIcon, CheckIcon, XIcon } from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { SORT_OPTIONS, directionOptions, isDefaultSort, sortOption, withDirection, withField } from "./sort-options";
import { ITEM, POP } from "./tokens";
import { DEFAULT_SORT, type SortState } from "./view-state";

type Picker = null | "field" | "direction";

const SELECT =
  "flex h-7 min-w-0 items-center gap-2 rounded-ds-xs bg-ds-surface px-2 text-sm font-medium text-ds-ink shadow-[inset_0_0_0_1px_var(--ds-border)] transition-shadow hover:shadow-[inset_0_0_0_1px_var(--ds-ghost)] focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--ds-ghost)]";

export interface SortControlProps {
  sort: SortState;
  onChange: (sort: SortState) => void;
}

export function SortControl({ sort, onChange }: SortControlProps) {
  const [open, setOpen] = useState(false);
  const [picker, setPicker] = useState<Picker>(null);

  const option = sortOption(sort.field);
  const directions = directionOptions(option.kind);
  const directionLabel = directions.find((d) => d.direction === sort.direction)?.label ?? directions[0].label;
  const atDefault = isDefaultSort(sort);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setPicker(null);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="leads-sort-trigger"
          className={cn(
            "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-ds-sm bg-ds-surface px-2 text-sm font-medium text-ds-ink shadow-[inset_0_0_0_1px_var(--ds-border)] transition-colors hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ds-ghost",
            open && "bg-ds-hover",
          )}
        >
          <ArrowsDownUpIcon className="size-4 shrink-0" />
          <span className="text-ds-muted">Sorted by</span>
          <span>{option.label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} className={cn(POP, "w-[420px] p-2")}>
        <div className="flex items-center gap-1.5 px-0.5 py-[3px]">
          <button type="button" aria-expanded={picker === "field"} className={cn(SELECT, "flex-1")} onClick={() => setPicker(picker === "field" ? null : "field")}>
            <span className="truncate">{option.label}</span>
            <CaretDownIcon className="ml-auto size-3.5 shrink-0 text-ds-faint" />
          </button>
          <button
            type="button"
            aria-expanded={picker === "direction"}
            className={cn(SELECT, "flex-[0.8]")}
            onClick={() => setPicker(picker === "direction" ? null : "direction")}
          >
            <span className="truncate">{directionLabel}</span>
            <CaretDownIcon className="ml-auto size-3.5 shrink-0 text-ds-faint" />
          </button>
          {atDefault ? (
            <span aria-hidden="true" className="size-6 shrink-0" />
          ) : (
            <button
              type="button"
              aria-label="Remove sort (back to Last activity, newest first)"
              title="Back to the default sort"
              onClick={() => {
                onChange(DEFAULT_SORT);
                setPicker(null);
              }}
              className="flex size-6 shrink-0 items-center justify-center rounded-ds-xs text-ds-faint transition-colors hover:bg-ds-hover hover:text-ds-ink"
            >
              <XIcon className="size-4" />
            </button>
          )}
        </div>

        {picker === "field" && (
          <div role="listbox" aria-label="Sort field" className="mt-1 border-t border-ds-divider pt-1">
            {SORT_OPTIONS.map((o) => (
              <button
                key={o.key}
                type="button"
                role="option"
                aria-selected={o.key === sort.field}
                className={ITEM}
                onClick={() => {
                  onChange(withField(sort, o.key));
                  setPicker(null);
                }}
              >
                {o.label}
                {o.key === sort.field && <CheckIcon className="ml-auto size-4 text-ds-muted" />}
              </button>
            ))}
          </div>
        )}
        {picker === "direction" && (
          <div role="listbox" aria-label="Sort direction" className="mt-1 border-t border-ds-divider pt-1">
            {directions.map((d) => (
              <button
                key={d.direction}
                type="button"
                role="option"
                aria-selected={d.direction === sort.direction}
                className={ITEM}
                onClick={() => {
                  onChange(withDirection(sort, d.direction));
                  setPicker(null);
                }}
              >
                {d.label}
                {d.direction === sort.direction && <CheckIcon className="ml-auto size-4 text-ds-muted" />}
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

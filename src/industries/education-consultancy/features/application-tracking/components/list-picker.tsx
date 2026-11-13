"use client";

// One searchable pick-list popover for the Applications List (EDGEX-141 Phase 4): the Stage cell's
// "Move to stage…" (mockup state 5) and the bulk bar's Move stage / Assign counsellor. Anchored to
// an element (a cell) or wrapped around a trigger (a bulk button). Picking an item closes it.
// Phase 5: container="sheet" renders the same body in a phone bottom sheet (the board's Move sheet).

import { useMemo, useState, type ReactNode } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { CheckIcon, MagnifyingGlassIcon } from "@/components/icons";
import { ITEM, POP, POP_LABEL, POP_SEARCH, POP_SEP } from "@/components/filters/toolbar/tokens";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { cn } from "@/lib/utils";

export interface PickerItem {
  value: string;
  label: string;
  leading?: ReactNode;
  checked?: boolean;
  /** Right-aligned muted text (the sheet's per-stage count). Hidden on the checked row. */
  meta?: ReactNode;
}

export interface PickerGroup {
  label?: string;
  items: PickerItem[];
}

export interface ListPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Anchor element (inline cell). Ignored when `trigger` is given. */
  anchor?: HTMLElement | null;
  trigger?: ReactNode;
  placeholder: string;
  groups: PickerGroup[];
  onPick: (value: string) => void;
  testId: string;
  width?: number;
  side?: "top" | "bottom";
  /** "popover" (default) or "sheet" (phone, Phase 5): the same rows in a bottom sheet. */
  container?: "popover" | "sheet";
  /** Sheet title / subtitle (sheet only). */
  title?: string;
  subtitle?: ReactNode;
  /** Show the search row (default on; the phone Move sheet has none, mockup state 3). */
  searchable?: boolean;
}

function PickerBody({
  query,
  setQuery,
  placeholder,
  groups,
  onPick,
  searchable,
  sheet,
}: {
  query: string;
  setQuery: (q: string) => void;
  placeholder: string;
  groups: PickerGroup[];
  onPick: (value: string) => void;
  searchable: boolean;
  sheet: boolean;
}) {
  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () => groups.map((g) => ({ ...g, items: g.items.filter((i) => !q || i.label.toLowerCase().includes(q)) })).filter((g) => g.items.length > 0),
    [groups, q],
  );
  return (
    <>
      {searchable && (
        <div className={POP_SEARCH}>
          <MagnifyingGlassIcon className="size-4 shrink-0" />
          <input
            autoFocus={!sheet}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const first = visible[0]?.items[0];
                if (first) {
                  e.preventDefault();
                  onPick(first.value);
                }
              }
            }}
            placeholder={placeholder}
            aria-label={placeholder}
            className="h-full min-w-0 flex-1 bg-transparent text-sm font-medium text-ds-ink outline-none placeholder:text-ds-faint"
          />
        </div>
      )}
      <div role="listbox" aria-label={placeholder} className="max-h-[320px] overflow-y-auto">
        {visible.map((g, gi) => (
          <div key={g.label ?? gi}>
            {gi > 0 && !sheet && <div className={POP_SEP} />}
            {g.label && <div className={sheet ? "px-2.5 pt-2.5 pb-1 text-[11px] font-medium text-ds-faint" : POP_LABEL}>{g.label}</div>}
            {g.items.map((i) => (
              <button
                key={i.value}
                type="button"
                role="option"
                aria-selected={!!i.checked}
                className={sheet ? cn(ITEM, "font-normal text-ds-text", i.checked && "bg-ds-hover text-ds-ink") : ITEM}
                onClick={() => onPick(i.value)}
              >
                {i.leading}
                <span className="min-w-0 flex-1 truncate">{i.label}</span>
                {i.checked ? (
                  <CheckIcon className={sheet ? "size-4 text-ds-accent" : "size-4 text-ds-ink"} />
                ) : (
                  i.meta !== undefined && <span className="text-[13px] font-normal text-ds-faint tabular-nums">{i.meta}</span>
                )}
              </button>
            ))}
          </div>
        ))}
        {visible.length === 0 && <div className="px-2 py-1.5 text-sm font-normal text-ds-faint">No matches</div>}
      </div>
    </>
  );
}

export function ListPicker({
  open,
  onOpenChange,
  anchor,
  trigger,
  placeholder,
  groups,
  onPick,
  testId,
  width = 230,
  side = "bottom",
  container = "popover",
  title,
  subtitle,
  searchable = true,
}: ListPickerProps) {
  const [query, setQuery] = useState("");
  const handleOpenChange = (o: boolean) => {
    if (o) setQuery("");
    onOpenChange(o);
  };
  const body = (
    <PickerBody
      query={query}
      setQuery={setQuery}
      placeholder={placeholder}
      groups={groups}
      onPick={onPick}
      searchable={searchable}
      sheet={container === "sheet"}
    />
  );

  if (container === "sheet") {
    return (
      <BottomSheet open={open} onOpenChange={handleOpenChange} title={title ?? placeholder} subtitle={subtitle} testId={testId}>
        {body}
      </BottomSheet>
    );
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      {trigger ? <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger> : anchor ? <PopoverPrimitive.Anchor virtualRef={{ current: anchor }} /> : null}
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          side={side}
          sideOffset={side === "top" ? 12 : 2}
          collisionPadding={8}
          data-testid={testId}
          style={{ width }}
          className={`${POP} z-50 outline-none`}
        >
          {body}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

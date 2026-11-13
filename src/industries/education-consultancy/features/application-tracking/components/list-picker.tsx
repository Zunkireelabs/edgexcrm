"use client";

// One searchable pick-list popover for the Applications List (EDGEX-141 Phase 4): the Stage cell's
// "Move to stage…" (mockup state 5) and the bulk bar's Move stage / Assign counsellor. Anchored to
// an element (a cell) or wrapped around a trigger (a bulk button). Picking an item closes it.

import { useMemo, useState, type ReactNode } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { CheckIcon, MagnifyingGlassIcon } from "@/components/icons";
import { ITEM, POP, POP_LABEL, POP_SEARCH, POP_SEP } from "@/components/filters/toolbar/tokens";

export interface PickerItem {
  value: string;
  label: string;
  leading?: ReactNode;
  checked?: boolean;
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
}

export function ListPicker({ open, onOpenChange, anchor, trigger, placeholder, groups, onPick, testId, width = 230, side = "bottom" }: ListPickerProps) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () => groups.map((g) => ({ ...g, items: g.items.filter((i) => !q || i.label.toLowerCase().includes(q)) })).filter((g) => g.items.length > 0),
    [groups, q],
  );

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(o) => {
        if (o) setQuery("");
        onOpenChange(o);
      }}
    >
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
          <div className={POP_SEARCH}>
            <MagnifyingGlassIcon className="size-4 shrink-0" />
            <input
              autoFocus
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
          <div role="listbox" aria-label={placeholder} className="max-h-[320px] overflow-y-auto">
            {visible.map((g, gi) => (
              <div key={g.label ?? gi}>
                {gi > 0 && <div className={POP_SEP} />}
                {g.label && <div className={POP_LABEL}>{g.label}</div>}
                {g.items.map((i) => (
                  <button
                    key={i.value}
                    type="button"
                    role="option"
                    aria-selected={!!i.checked}
                    className={ITEM}
                    onClick={() => onPick(i.value)}
                  >
                    {i.leading}
                    <span className="min-w-0 flex-1 truncate">{i.label}</span>
                    {i.checked && <CheckIcon className="size-4 text-ds-ink" />}
                  </button>
                ))}
              </div>
            ))}
            {visible.length === 0 && <div className="px-2 py-1.5 text-sm font-normal text-ds-faint">No matches</div>}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

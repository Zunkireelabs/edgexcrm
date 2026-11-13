"use client";

// The two list panels that live inside the filter popovers (EDGEX-116):
//   FieldMenuPanel  — "Filter by…" search + Most used / All fields, type icons, option count + chevron
//   ValuesPanel     — "Search stages…" + checkbox rows, colour dot, right-aligned per-option count
// Both match temp_ss/leads-table-v2.html: 32px rows, hairline search row, 14px/500 Inter.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { CaretRightIcon, CheckIcon, MagnifyingGlassIcon } from "@/components/icons";
import type { FieldDef } from "@/lib/filters/types";
import { cn } from "@/lib/utils";
import { FieldIcon } from "./field-icon";
import { filterOptionRows, type OptionRow } from "./option-view";
import { ITEM, POP_LABEL, POP_SEARCH, POP_SEP } from "./tokens";

/** Up/Down/Enter roving highlight for a searchable list. */
function useListNav(length: number) {
  const [active, setActive] = useState(0);
  const clamped = length === 0 ? 0 : Math.min(active, length - 1);
  function onKeyDown(e: KeyboardEvent, onEnter: (index: number) => void) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((clamped + 1) % Math.max(length, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((clamped - 1 + Math.max(length, 1)) % Math.max(length, 1));
    } else if (e.key === "Enter" && length > 0) {
      e.preventDefault();
      onEnter(clamped);
    }
  }
  return { active: clamped, setActive, onKeyDown };
}

function SearchRow({
  value,
  onChange,
  placeholder,
  onKeyDown,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className={POP_SEARCH}>
      <MagnifyingGlassIcon className="size-4 shrink-0" />
      <input
        ref={inputRef}
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-full min-w-0 flex-1 bg-transparent text-sm font-medium text-ds-ink outline-none placeholder:text-ds-faint"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------

export interface FieldMenuPanelProps {
  fields: FieldDef[];
  /** Registry keys shown first under "Most used" (those the tenant can actually filter by). */
  mostUsedKeys: string[];
  /** Number of pickable options for a field, or undefined when it isn't a pick-list. */
  optionCount: (field: FieldDef) => number | undefined;
  onSelect: (field: FieldDef) => void;
}

export function FieldMenuPanel({ fields, mostUsedKeys, optionCount, onSelect }: FieldMenuPanelProps) {
  const [query, setQuery] = useState("");

  const pickable = useMemo(() => fields.filter((f) => f.filterable && !f.hiddenFromPicker), [fields]);
  const { mostUsed, rest } = useMemo(() => {
    const byKey = new Map(pickable.map((f) => [f.key, f]));
    const top = mostUsedKeys.map((k) => byKey.get(k)).filter((f): f is FieldDef => !!f);
    const topKeys = new Set(top.map((f) => f.key));
    return { mostUsed: top, rest: pickable.filter((f) => !topKeys.has(f.key)) };
  }, [pickable, mostUsedKeys]);

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const flat = useMemo(
    () => (searching ? pickable.filter((f) => f.label.toLowerCase().includes(q)) : [...mostUsed, ...rest]),
    [searching, pickable, q, mostUsed, rest],
  );
  const nav = useListNav(flat.length);

  function row(field: FieldDef, index: number) {
    const n = optionCount(field);
    return (
      <button
        key={field.key}
        type="button"
        role="option"
        aria-selected={nav.active === index}
        data-active={nav.active === index}
        onMouseEnter={() => nav.setActive(index)}
        onClick={() => onSelect(field)}
        className={ITEM}
      >
        <FieldIcon field={field} className="size-4 shrink-0 text-ds-muted" />
        <span className="truncate">{field.label}</span>
        {n !== undefined && (
          <span className="ml-auto flex items-center gap-0.5 text-xs font-normal text-ds-faint">
            {n}
            <CaretRightIcon className="size-3.5" />
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="w-[260px]" role="listbox" aria-label="Filter by field">
      <SearchRow
        value={query}
        onChange={setQuery}
        placeholder="Filter by…"
        onKeyDown={(e) => nav.onKeyDown(e, (i) => onSelect(flat[i]))}
      />
      <div className="max-h-[320px] overflow-y-auto">
        {flat.length === 0 && <p className="px-2 py-3 text-sm font-normal text-ds-faint">No matching fields.</p>}
        {!searching && mostUsed.length > 0 && <div className={POP_LABEL}>Most used</div>}
        {!searching && mostUsed.map((f, i) => row(f, i))}
        {!searching && mostUsed.length > 0 && rest.length > 0 && (
          <>
            <div className={POP_SEP} />
            <div className={POP_LABEL}>All fields</div>
          </>
        )}
        {!searching && rest.map((f, i) => row(f, mostUsed.length + i))}
        {searching && flat.map((f, i) => row(f, i))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------

const PLURAL_BY_KEY: Record<string, string> = {
  stage: "stages",
  assignees: "people",
  collaborators: "people",
  source: "sources",
  tags: "tags",
  destinations: "destinations",
};

export interface ValuesPanelProps {
  field: FieldDef;
  rows: OptionRow[];
  selected: string[];
  onToggle: (value: string) => void;
  /** Counts are still arriving: show the rows now, numbers when they land. */
  countsLoading?: boolean;
}

export function ValuesPanel({ field, rows, selected, onToggle, countsLoading }: ValuesPanelProps) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => filterOptionRows(rows, query), [rows, query]);
  const nav = useListNav(visible.length);
  const listRef = useRef<HTMLDivElement>(null);
  const placeholder = `Search ${PLURAL_BY_KEY[field.key] ?? field.label.toLowerCase()}…`;

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [nav.active]);

  const picked = new Set(selected);

  return (
    <div className="w-[250px]" role="listbox" aria-multiselectable="true" aria-label={field.label}>
      <SearchRow
        value={query}
        onChange={setQuery}
        placeholder={placeholder}
        onKeyDown={(e) => nav.onKeyDown(e, (i) => onToggle(visible[i].value))}
      />
      <div ref={listRef} className="max-h-[320px] overflow-y-auto">
        {visible.length === 0 && <p className="px-2 py-3 text-sm font-normal text-ds-faint">Nothing matches.</p>}
        {visible.map((row, i) => {
          const on = picked.has(row.value);
          return (
            <button
              key={row.value}
              type="button"
              role="option"
              aria-selected={on}
              data-active={nav.active === i}
              onMouseEnter={() => nav.setActive(i)}
              onClick={() => onToggle(row.value)}
              className={ITEM}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-[5px]",
                  on ? "bg-ds-accent" : "bg-ds-surface shadow-[inset_0_0_0_1.5px_var(--ds-ghost)]",
                )}
              >
                {on && <CheckIcon className="size-3 text-white" />}
              </span>
              {row.color && <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />}
              <span className="truncate">{row.label}</span>
              {row.count !== undefined ? (
                <span className="ml-auto text-xs font-normal tabular-nums text-ds-faint">{row.count.toLocaleString()}</span>
              ) : countsLoading ? (
                <span aria-hidden="true" className="ml-auto h-2.5 w-6 animate-pulse rounded-full bg-ds-divider" />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

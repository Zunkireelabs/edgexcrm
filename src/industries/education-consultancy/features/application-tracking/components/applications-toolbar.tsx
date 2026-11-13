"use client";

// Applications toolbar (EDGEX-141 Phase 2): tabs row + bar row, per mockup states 2 and 4.
// Built from the promoted Leads v2 parts in components/filters/toolbar/ (chips, filter menu,
// search field, tokens). All state lives in the URL; this component only lays it out.

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowsDownUpIcon, CheckIcon } from "@/components/icons";
import { FilterChips } from "@/components/filters/toolbar/filter-chips";
import { FilterMenu } from "@/components/filters/toolbar/filter-menu";
import { SearchField } from "@/components/filters/toolbar/search-field";
import type { OptionContext } from "@/components/filters/toolbar/condition-body";
import { ITEM, POP } from "@/components/filters/toolbar/tokens";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isEmptyTree } from "@/lib/filters/serialize";
import type { FieldDef, FilterTree } from "@/lib/filters/types";
import { cn } from "@/lib/utils";
import { PRIMARY_APPLICATION_SORTS, sortFieldOf, type ApplicationSort } from "../lib/applications-query";
import { APPLICATION_TABS, SORT_LABELS, type ApplicationTab } from "../lib/applications-url";
import type { TabCounts } from "../lib/applications-url";
import { COLUMN_WIDTHS, type ColumnWidth } from "../lib/board-view-prefs";

const TAB_LABEL: Record<ApplicationTab, string> = { all: "All applications", mine: "My applications", stuck: "Stuck 30d+" };

/** `counts` null = the unfiltered read failed: badges hide rather than read 0. */
export function ApplicationsTabs({ active, counts, onSelect }: { active: ApplicationTab; counts: TabCounts | null; onSelect: (t: ApplicationTab) => void }) {
  return (
    <div role="tablist" aria-label="Applications view" className="flex items-end gap-0.5 border-b border-ds-border pt-2">
      {APPLICATION_TABS.map((t) => {
        const on = t === active;
        return (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={on}
            data-testid={`applications-tab-${t}`}
            onClick={() => onSelect(t)}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-2.5 pt-[7px] pb-[9px] text-sm font-medium transition-colors",
              on ? "border-ds-ink text-ds-ink" : "border-transparent text-ds-muted hover:text-ds-ink",
            )}
          >
            {TAB_LABEL[t]}
            {counts && (
              <span
                data-testid={`applications-tab-count-${t}`}
                className={cn(
                  "rounded-full px-1.5 text-[11px] font-semibold leading-[18px] tabular-nums",
                  t === "stuck" ? "bg-ds-bad-soft text-ds-bad" : "bg-ds-hover text-ds-muted",
                )}
              >
                {counts[t].toLocaleString()}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function SortChip({ sort, onChange }: { sort: ApplicationSort; onChange: (s: ApplicationSort) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="applications-sort-trigger"
          className={cn(
            "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-ds-sm bg-ds-surface px-2 text-sm font-medium text-ds-ink shadow-[inset_0_0_0_1px_var(--ds-border)] transition-colors hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ds-ghost",
            open && "bg-ds-hover",
          )}
        >
          <ArrowsDownUpIcon className="size-4 shrink-0" />
          <span className="text-ds-muted">Sorted by</span>
          <span>{SORT_LABELS[sort]}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} className={cn(POP, "w-[220px]")}>
        <div role="listbox" aria-label="Sort applications">
          {PRIMARY_APPLICATION_SORTS.map((s) => {
            // A reversed direction (set from a list column menu) checks its field's row and shows its own label.
            const on = sortFieldOf(s).field === sortFieldOf(sort).field;
            return (
              <button
                key={s}
                type="button"
                role="option"
                aria-selected={on}
                className={ITEM}
                onClick={() => {
                  onChange(s);
                  setOpen(false);
                }}
              >
                {on ? SORT_LABELS[sort] : SORT_LABELS[s]}
                {on && <CheckIcon className="ml-auto size-4 text-ds-muted" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const SEG = "inline-flex rounded-ds-sm bg-ds-hover p-0.5 gap-0.5";
const SEG_BTN =
  "inline-flex h-[26px] min-w-7 items-center justify-center gap-1.5 rounded-[6px] px-2 text-sm font-medium text-ds-muted transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ds-ghost";
const SEG_ON = "bg-ds-surface text-ds-ink shadow-[0_1px_2px_rgba(0,0,0,.06),inset_0_0_0_1px_var(--ds-border)]";

function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export interface ApplicationsToolbarProps {
  tab: ApplicationTab;
  tabCounts: TabCounts | null;
  onTab: (t: ApplicationTab) => void;
  q: string;
  onSearch: (q: string) => void;
  sort: ApplicationSort;
  onSort: (s: ApplicationSort) => void;
  fields: FieldDef[];
  tree: FilterTree;
  onTreeChange: (t: FilterTree) => void;
  optionCtx: OptionContext;
  mostUsedKeys: string[];
  filterError: string | null;
  columnWidth: ColumnWidth;
  onColumnWidth: (w: ColumnWidth) => void;
  view: "board" | "list";
  onView: (v: "board" | "list") => void;
  /** "Edit columns" (list view only). */
  listActions?: React.ReactNode;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function ApplicationsToolbar(p: ApplicationsToolbarProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [text, setText] = useState(p.q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasFilters = !isEmptyTree(p.tree);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function onSearchChange(value: string) {
    setText(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => p.onSearch(value.trim()), 300);
  }

  // `/` focuses search, `F` opens the filter menu (same shortcuts as Leads).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        setFilterOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const maxConditions = useMemo(() => 12, []);

  return (
    <div className="shrink-0" data-testid="applications-toolbar">
      <ApplicationsTabs active={p.tab} counts={p.tabCounts} onSelect={p.onTab} />
      <div className="flex min-h-[50px] flex-wrap items-center gap-2 border-b border-ds-border py-2">
        <SearchField
          ref={searchRef}
          value={text}
          onChange={onSearchChange}
          placeholder="Search applications"
          ariaLabel="Search applications"
          testId="applications-search"
        />
        <SortChip sort={p.sort} onChange={p.onSort} />
        <FilterChips fields={p.fields} tree={p.tree} onChange={p.onTreeChange} ctx={p.optionCtx} maxConditions={maxConditions} variant="pill" />
        <FilterMenu
          fields={p.fields}
          tree={p.tree}
          onChange={p.onTreeChange}
          ctx={p.optionCtx}
          mostUsedKeys={p.mostUsedKeys}
          variant={hasFilters ? "dashed-plus" : "chip"}
          maxConditions={maxConditions}
          open={filterOpen}
          onOpenChange={setFilterOpen}
          testId="applications-filter-trigger"
        />
        {p.filterError && (
          <span data-testid="applications-filter-error" role="status" className="inline-flex h-7 items-center rounded-ds-sm bg-ds-warn-soft px-2 text-sm font-medium text-ds-warn">
            {p.filterError}
          </span>
        )}
        <span className="flex-1" />
        {p.view === "board" && (
          <span className={SEG} title="Column width" role="group" aria-label="Column width">
            {COLUMN_WIDTHS.map((w) => (
              <button
                key={w}
                type="button"
                title={w === "narrow" ? "Narrow columns" : "Wide columns"}
                aria-label={w === "narrow" ? "Narrow columns" : "Wide columns"}
                aria-pressed={p.columnWidth === w}
                data-testid={`column-width-${w}`}
                onClick={() => p.onColumnWidth(w)}
                className={cn(SEG_BTN, p.columnWidth === w && SEG_ON)}
              >
                {w === "narrow" ? (
                  <Svg><path d="M8 5v14M12 5v14M16 5v14" /></Svg>
                ) : (
                  <Svg><rect x="4" y="5" width="6" height="14" rx="2" /><rect x="14" y="5" width="6" height="14" rx="2" /></Svg>
                )}
              </button>
            ))}
          </span>
        )}
        {p.view === "list" && p.listActions}
        <span aria-hidden="true" className="h-[18px] w-px bg-ds-border" />
        <span className={SEG} role="group" aria-label="View">
          <button type="button" aria-pressed={p.view === "board"} data-testid="view-board" onClick={() => p.onView("board")} className={cn(SEG_BTN, p.view === "board" && SEG_ON)}>
            <Svg><rect x="3" y="4" width="5" height="16" rx="1.5" /><rect x="10" y="4" width="5" height="11" rx="1.5" /><rect x="17" y="4" width="4" height="7" rx="1.5" /></Svg>
            Board
          </button>
          <button type="button" aria-pressed={p.view === "list"} data-testid="view-list" onClick={() => p.onView("list")} className={cn(SEG_BTN, p.view === "list" && SEG_ON)}>
            <Svg><path d="M4 6h16M4 12h16M4 18h16" /></Svg>
            List
          </button>
        </span>
      </div>
    </div>
  );
}


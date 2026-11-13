"use client";

// Applications toolbar (EDGEX-141 Phase 2): tabs row + bar row, per mockup states 2 and 4.
// Built from the promoted Leads v2 parts in components/filters/toolbar/ (chips, filter menu,
// search field, tokens). All state lives in the URL; this component only lays it out.
//
// Phone (below md, EDGEX-141 Phase 5, temp_ss/applications-phone-v1.html): CSS-first. Phone-only
// parts are `md:hidden`; desktop-only parts get `max-md:hidden`; the chip row is a wrapper that is
// `display: contents` on desktop (no box, so desktop layout is untouched) and a sideways-scrolling
// flex row on phone. The popovers switch to bottom sheets via useBelowMd (behaviour, not layout).

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowsDownUpIcon, CheckIcon, MagnifyingGlassIcon } from "@/components/icons";
import { BottomSheet } from "@/components/ui/bottom-sheet";
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
import { useBelowMd } from "../hooks/use-below-md";

const TAB_LABEL: Record<ApplicationTab, string> = { all: "All applications", mine: "My applications", stuck: "Stuck 30d+" };
/** Phone tab labels (mockup state 1: one line, scrolls sideways if needed). */
const TAB_LABEL_PHONE: Record<ApplicationTab, string> = { all: "All", mine: "Mine", stuck: "Stuck 30d+" };

/** `counts` null = the unfiltered read failed: badges hide rather than read 0. */
export function ApplicationsTabs({
  active,
  counts,
  onSelect,
  right,
  phoneEnd,
}: {
  active: ApplicationTab;
  counts: TabCounts | null;
  onSelect: (t: ApplicationTab) => void;
  /** Right end of the tabs row (list view: "View settings", mockup state 6). Hidden below md. */
  right?: React.ReactNode;
  /** Right end of the tabs row below md only (the icon Board/List toggle). */
  phoneEnd?: React.ReactNode;
}) {
  return (
    <div className="flex items-center border-b border-ds-border">
    <div role="tablist" aria-label="Applications view" className="flex flex-1 items-end gap-0.5 pt-2 max-md:no-scrollbar max-md:min-w-0 max-md:overflow-x-auto">
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
              "-mb-px flex items-center gap-1.5 border-b-2 px-2.5 pt-[7px] pb-[9px] text-sm font-medium transition-colors max-md:shrink-0 max-md:gap-0 max-md:whitespace-nowrap max-md:px-2 max-md:text-[0px]",
              on ? "border-ds-ink text-ds-ink" : "border-transparent text-ds-muted hover:text-ds-ink",
            )}
          >
            {TAB_LABEL[t]}
            <span className="mr-1.5 text-sm md:hidden">{TAB_LABEL_PHONE[t]}</span>
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
    {right && <div className="flex shrink-0 items-center pt-2 max-md:hidden">{right}</div>}
    {phoneEnd && <div className="ml-2 flex shrink-0 items-end self-end pb-[5px] md:hidden">{phoneEnd}</div>}
    </div>
  );
}

function SortChip({ sort, onChange, sheet = false }: { sort: ApplicationSort; onChange: (s: ApplicationSort) => void; sheet?: boolean }) {
  const [open, setOpen] = useState(false);
  const trigger = (
        <button
          type="button"
          data-testid="applications-sort-trigger"
          onClick={sheet ? () => setOpen(true) : undefined}
          className={cn(
            "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-ds-sm bg-ds-surface px-2 text-sm font-medium text-ds-ink shadow-[inset_0_0_0_1px_var(--ds-border)] transition-colors hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ds-ghost max-md:h-8 max-md:px-2.5 max-md:text-[13px] max-md:text-ds-muted",
            open && "bg-ds-hover",
          )}
        >
          <ArrowsDownUpIcon className="size-4 shrink-0" />
          <span className="text-ds-muted max-md:hidden">Sorted by</span>
          <span className="max-md:text-ds-ink">{SORT_LABELS[sort]}</span>
        </button>
  );
  const list = (
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
  );
  if (sheet) {
    return (
      <>
        {trigger}
        <BottomSheet open={open} onOpenChange={setOpen} title="Sort by" testId="applications-sort-sheet">
          {list}
        </BottomSheet>
      </>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger}
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} className={cn(POP, "w-[220px]")}>
        {list}
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
  /** List view only: the tabs row's right end ("View settings"). */
  listActions?: React.ReactNode;
  /** Column menu "Filter by …": a new nonce opens the filter menu on that field (Leads pattern). */
  filterRequest?: { fieldKey: string; nonce: number } | null;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

const BOARD_ICON = <><rect x="3" y="4" width="5" height="16" rx="1.5" /><rect x="10" y="4" width="5" height="11" rx="1.5" /><rect x="17" y="4" width="4" height="7" rx="1.5" /></>;
const LIST_ICON = <path d="M4 6h16M4 12h16M4 18h16" />;

/** Phone Board/List toggle (mockup `.seg`): icon-only 34x28 buttons at the right end of the tabs row. */
function PhoneViewToggle({ view, onView }: { view: "board" | "list"; onView: (v: "board" | "list") => void }) {
  const btn = (v: "board" | "list", label: string, icon: React.ReactNode) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={view === v}
      data-testid={`view-${v}-phone`}
      onClick={() => onView(v)}
      className={cn(
        "inline-flex h-7 w-[34px] items-center justify-center rounded-[8px] text-ds-muted transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ds-ghost",
        view === v && "bg-ds-surface text-ds-ink shadow-[0_1px_2px_rgba(0,0,0,.06),0_0_0_1px_rgba(0,0,0,.06)]",
      )}
    >
      <svg viewBox="0 0 24 24" className="size-[15px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {icon}
      </svg>
    </button>
  );
  return (
    <span role="group" aria-label="View" className="inline-flex gap-0.5 rounded-[10px] bg-ds-hover p-0.5">
      {btn("board", "Board", BOARD_ICON)}
      {btn("list", "List", LIST_ICON)}
    </span>
  );
}

/** Phone chip row: shared chips + Filter trigger grow to 32px, the Filter chip gets the mockup's dashed border. */
const PHONE_ROW =
  "contents max-md:flex max-md:min-w-0 max-md:flex-1 max-md:items-center max-md:gap-2 max-md:overflow-x-auto max-md:no-scrollbar max-md:[mask-image:linear-gradient(90deg,#000_calc(100%-16px),transparent)] max-md:[&_[data-testid=filter-chip]]:h-8 max-md:[&_[data-testid=applications-filter-trigger]]:h-8 max-md:[&_[data-testid=applications-filter-trigger]]:border max-md:[&_[data-testid=applications-filter-trigger]]:border-dashed max-md:[&_[data-testid=applications-filter-trigger]]:border-ds-ghost max-md:[&_[data-testid=applications-filter-trigger]]:rounded-[8px] max-md:[&_[data-testid=applications-filter-trigger]]:text-[13px]";
const PHONE_CHIP_ICON =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] border border-ds-border bg-ds-surface text-ds-muted md:hidden";

export function ApplicationsToolbar(p: ApplicationsToolbarProps) {
  const phone = useBelowMd();
  const container = phone ? "sheet" : "popover";
  // Phone: tapping the search chip turns the chip row into a 36px input with Cancel.
  const [phoneSearch, setPhoneSearch] = useState(false);
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [seenFilterNonce, setSeenFilterNonce] = useState<number | null>(p.filterRequest?.nonce ?? null);
  if (p.filterRequest && p.filterRequest.nonce !== seenFilterNonce) {
    setSeenFilterNonce(p.filterRequest.nonce);
    setFilterOpen(true);
  }
  const [text, setText] = useState(p.q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasFilters = !isEmptyTree(p.tree);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function commitSearchNow(value: string) {
    if (timer.current) clearTimeout(timer.current);
    setText(value);
    p.onSearch(value.trim());
  }

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
      <ApplicationsTabs
        active={p.tab}
        counts={p.tabCounts}
        onSelect={p.onTab}
        right={p.view === "list" ? p.listActions : undefined}
        phoneEnd={<PhoneViewToggle view={p.view} onView={p.onView} />}
      />
      <div className="flex min-h-[50px] flex-wrap items-center gap-2 border-b border-ds-border py-2 max-md:min-h-0 max-md:flex-nowrap">
        {phone && phoneSearch ? (
          <div className="flex min-w-0 flex-1 items-center gap-2 md:hidden" data-testid="applications-search-phone-row">
            <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[8px] border border-ds-border px-2.5 text-ds-faint focus-within:border-ds-ghost">
              <MagnifyingGlassIcon className="size-[15px] shrink-0" />
              <input
                ref={phoneInputRef}
                autoFocus
                type="search"
                enterKeyHint="search"
                value={text}
                onChange={(e) => onSearchChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    commitSearchNow(e.currentTarget.value);
                    setPhoneSearch(false);
                  } else if (e.key === "Escape") setPhoneSearch(false);
                }}
                placeholder="Search applications"
                aria-label="Search applications"
                data-testid="applications-search-phone"
                className="h-full min-w-0 flex-1 bg-transparent text-[14px] font-medium text-ds-ink outline-none placeholder:font-normal placeholder:text-ds-faint [&::-webkit-search-cancel-button]:hidden"
              />
            </label>
            <button
              type="button"
              data-testid="applications-search-cancel"
              onClick={() => {
                commitSearchNow("");
                setPhoneSearch(false);
              }}
              className="h-9 shrink-0 px-1 text-[14px] font-medium text-ds-accent"
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
        <span className="contents max-md:hidden">
        <SearchField
          ref={searchRef}
          value={text}
          onChange={onSearchChange}
          placeholder="Search applications"
          ariaLabel="Search applications"
          testId="applications-search"
        />
        </span>
        <div className={cn(PHONE_ROW, hasFilters && "max-md:[&_[data-testid=applications-filter-trigger]]:w-8 max-md:[&_[data-testid=applications-filter-trigger]]:px-0")} data-testid="applications-chip-row">
        {p.q ? (
          <span data-testid="applications-query-chip" className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[8px] border border-ds-border bg-ds-sunken px-2.5 text-[13px] font-semibold text-ds-ink md:hidden">
            <button type="button" aria-label="Edit search" onClick={() => setPhoneSearch(true)} className="max-w-[140px] truncate">
              “{p.q}”
            </button>
            <button type="button" aria-label="Clear search" onClick={() => commitSearchNow("")} className="font-medium text-ds-faint">
              ×
            </button>
          </span>
        ) : (
          <button type="button" title="Search" aria-label="Search applications" data-testid="applications-search-chip" onClick={() => setPhoneSearch(true)} className={PHONE_CHIP_ICON}>
            <MagnifyingGlassIcon className="size-[15px]" />
          </button>
        )}
        <SortChip sort={p.sort} onChange={p.onSort} sheet={phone} />
        <FilterChips fields={p.fields} tree={p.tree} onChange={p.onTreeChange} ctx={p.optionCtx} maxConditions={maxConditions} variant="pill" container={container} />
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
          request={p.filterRequest ?? null}
          testId="applications-filter-trigger"
          container={container}
        />
        {p.filterError && (
          <span data-testid="applications-filter-error" role="status" className="inline-flex h-7 items-center rounded-ds-sm bg-ds-warn-soft px-2 text-sm font-medium text-ds-warn max-md:shrink-0 max-md:whitespace-nowrap">
            {p.filterError}
          </span>
        )}
        </div>
          </>
        )}
        <span className="flex-1 max-md:hidden" />
        {p.view === "board" && (
          <span className={cn(SEG, "max-md:hidden")} title="Column width" role="group" aria-label="Column width">
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
        {p.view === "board" && <span aria-hidden="true" className="h-[18px] w-px bg-ds-border max-md:hidden" />}
        <span className={cn(SEG, "max-md:hidden")} role="group" aria-label="View">
          <button type="button" aria-pressed={p.view === "board"} data-testid="view-board" onClick={() => p.onView("board")} className={cn(SEG_BTN, p.view === "board" && SEG_ON)}>
            <Svg>{BOARD_ICON}</Svg>
            Board
          </button>
          <button type="button" aria-pressed={p.view === "list"} data-testid="view-list" onClick={() => p.onView("list")} className={cn(SEG_BTN, p.view === "list" && SEG_ON)}>
            <Svg>{LIST_ICON}</Svg>
            List
          </button>
        </span>
      </div>
    </div>
  );
}


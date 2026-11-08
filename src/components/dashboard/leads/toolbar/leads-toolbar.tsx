"use client";

// Leads toolbar v2 shell (EDGEX-116). Three rows, as in the approved mockup
// (temp_ss/leads-table-v2.html):
//   1. title row      Leads  [count]            [actions: Export · Add lead]
//   2. view tabs row  [tabs…]                   [Kanban · View settings]
//   3. search · sort · filter chips · Filter       … Unsaved changes · Discard · Save as view
// leads-table.tsx still owns every piece of state (filter tree in the URL, sort, search, fetch);
// this component only lays it out and runs the active-view baseline (dirty / discard / save).

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { UsersIcon } from "@/components/icons";
import { isEmptyTree } from "@/lib/filters/serialize";
import type { FieldDef, FilterTree } from "@/lib/filters/types";
import { useSavedLeadFilters } from "@/industries/education-consultancy/features/saved-lead-filters/lib/use-saved-lead-filters";
import type { OptionContext } from "./condition-body";
import { FilterChips } from "./filter-chips";
import { FilterMenu } from "./filter-menu";
import { SearchField } from "./search-field";
import { UnsavedBar } from "./unsaved-bar";
import { DEFAULT_SORT, baselineFromState, discardToBaseline, isViewDirty, type SortState, type ViewBaseline } from "./view-state";

/** Registry keys offered first in the Filter menu. */
export const MOST_USED_FILTER_KEYS = ["stage", "assignees", "last_activity_at"];

export interface LeadsToolbarProps {
  title: string;
  total: number;
  /** Row 1, right: Export, Add lead … */
  titleActions: ReactNode;
  /** Row 2, left: the view tabs (EDGEX-116 piece 3). */
  viewTabs?: ReactNode;
  /** Row 2, right: Kanban toggle, View settings. */
  viewActions: ReactNode;
  search: { value: string; onChange: (value: string) => void; loading: boolean };
  /** The sort control (chip + popover). */
  sortControl: ReactNode;
  filter: {
    fields: FieldDef[];
    /** What the chips show (real tree plus the synthetic current-tab Stage chip). */
    tree: FilterTree;
    onChange: (tree: FilterTree) => void;
    ctx: OptionContext;
    maxConditions: number;
  };
  /** The tree that means "this scope with no extra filters" — All leads, or the locked Stage tab. */
  scopeTree: FilterTree;
  sort: SortState;
  onSortChange: (sort: SortState) => void;
  /** Saved views are an education_consultancy feature; false hides Save as view. */
  savedViewsEnabled: boolean;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function LeadsToolbar({
  title,
  total,
  titleActions,
  viewTabs,
  viewActions,
  search,
  sortControl,
  filter,
  scopeTree,
  sort,
  onSortChange,
  savedViewsEnabled,
}: LeadsToolbarProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const saved = useSavedLeadFilters();

  // The active view's baseline. Starts as "this scope, default sort"; leads-table remounts the
  // toolbar (key) when the scope changes, so a new tab starts clean.
  const [baseline, setBaseline] = useState<ViewBaseline>(() => ({ id: "all", tree: scopeTree, sort: DEFAULT_SORT }));
  const current = useMemo(() => ({ tree: filter.tree, sort }), [filter.tree, sort]);
  const dirty = isViewDirty(baseline, current);
  const hasFilters = !isEmptyTree(filter.tree);

  function discard() {
    const restored = discardToBaseline(baseline);
    filter.onChange(restored.tree);
    onSortChange(restored.sort);
  }

  async function saveView(name: string): Promise<string | null> {
    const result = await saved.create(name.trim(), filter.tree);
    if ("error" in result) return result.error;
    setBaseline(baselineFromState(result.filter.id, current));
    toast.success(`Saved “${result.filter.name}”`);
    return null;
  }

  // Shortcuts: `/` focuses search, `F` opens the filter menu. Esc is handled by the popovers.
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

  return (
    <div className="shrink-0 bg-ds-surface" data-testid="leads-toolbar-v2">
      {/* Row 1 — title */}
      <div className="flex h-[52px] items-center gap-2 pl-4 pr-3">
        <span className="flex size-5 items-center justify-center rounded-ds-xs bg-ds-accent-soft text-ds-accent">
          <UsersIcon className="size-3.5" />
        </span>
        <h1 className="text-base font-semibold tracking-[-0.01em] text-ds-ink">{title}</h1>
        <span className="rounded-full bg-ds-hover px-2 text-xs font-medium leading-5 tabular-nums text-ds-muted" data-testid="leads-count">
          {total.toLocaleString()}
        </span>
        <span className="flex-1" />
        <div className="flex items-center gap-2">{titleActions}</div>
      </div>

      {/* Row 2 — view tabs */}
      <div className="flex h-10 items-center gap-0.5 border-b border-ds-border px-3">
        {viewTabs}
        <span className="flex-1" />
        <div className="flex items-center gap-1">{viewActions}</div>
      </div>

      {/* Row 3 — search · sort · filters */}
      <div className="flex min-h-12 flex-wrap items-center gap-2 py-1.5 pl-4 pr-3">
        <SearchField ref={searchRef} value={search.value} onChange={search.onChange} loading={search.loading} />
        {sortControl}
        <FilterChips fields={filter.fields} tree={filter.tree} onChange={filter.onChange} ctx={filter.ctx} maxConditions={filter.maxConditions} />
        <FilterMenu
          fields={filter.fields}
          tree={filter.tree}
          onChange={filter.onChange}
          ctx={filter.ctx}
          mostUsedKeys={MOST_USED_FILTER_KEYS}
          variant={hasFilters ? "plus" : "chip"}
          maxConditions={filter.maxConditions}
          open={filterOpen}
          onOpenChange={setFilterOpen}
        />
        <span className="flex-1" />
        {dirty && <UnsavedBar canSave={savedViewsEnabled && hasFilters} onDiscard={discard} onSave={saveView} />}
      </div>
    </div>
  );
}

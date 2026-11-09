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
import type { FieldDef, FieldRegistry, FilterTree } from "@/lib/filters/types";
import { prepareSavedFilterTree } from "@/industries/education-consultancy/features/saved-lead-filters/lib/apply-saved-filter";
import { useSavedLeadFilters, type SavedLeadFilter } from "@/industries/education-consultancy/features/saved-lead-filters/lib/use-saved-lead-filters";
import { buildBuiltinViews, matchBuiltinView, matchSavedView, singleValueTree, type ViewDef } from "./builtin-views";
import { fetchLeadCount } from "./lead-count";
import { ViewTabs } from "./view-tabs";
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
  /** Column menu → "Filter by …": opens the Filter menu on that field (a fresh nonce re-opens it). */
  filterRequest?: { fieldKey: string; nonce: number } | null;
  sort: SortState;
  onSortChange: (sort: SortState) => void;
  /** Saved views are an education_consultancy feature; false hides Save as view. */
  savedViewsEnabled: boolean;
  views: {
    currentUserId: string;
    /** The tenant's Applications lead list id (tab hidden when null). */
    applicationsListId: string | null;
    archiveSlug: string | null;
    trashSlug: string | null;
    onOpenList: (slug: string) => void;
    /** Registry used to re-validate a saved view's tree when it is applied. */
    registry: FieldRegistry;
  };
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
  filterRequest,
  sort,
  onSortChange,
  savedViewsEnabled,
  views,
}: LeadsToolbarProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  // Column menu → "Filter by …": a new request nonce opens the Filter menu (state adjusted during render).
  const [seenFilterNonce, setSeenFilterNonce] = useState<number | null>(filterRequest?.nonce ?? null);
  if (filterRequest && filterRequest.nonce !== seenFilterNonce) {
    setSeenFilterNonce(filterRequest.nonce);
    setFilterOpen(true);
  }
  const saved = useSavedLeadFilters();

  // --- view tabs + the active view's baseline ----------------------------------------
  const [activeSaved, setActiveSaved] = useState<{ id: string; name: string } | null>(null);
  const fieldKeys = useMemo(() => new Set(filter.fields.map((f) => f.key)), [filter.fields]);
  const builtin = useMemo(
    () => buildBuiltinViews({ scopeTree, currentUserId: views.currentUserId, fieldKeys, applicationsListId: views.applicationsListId }),
    [scopeTree, views.currentUserId, fieldKeys, views.applicationsListId],
  );
  const current = useMemo(() => ({ tree: filter.tree, sort }), [filter.tree, sort]);

  // Until the user picks or saves a view, the active view is whichever built-in tab the current
  // state equals (else "All leads", so anything extra reads as unsaved changes). Once they pick or
  // save one, that choice is the baseline. leads-table remounts this toolbar (key) when the scope
  // changes, so a new tab starts clean.
  const [explicit, setExplicit] = useState<ViewBaseline | null>(null);
  const implicit = useMemo<ViewBaseline>(() => {
    const match = matchBuiltinView(builtin, current);
    if (match) return { id: match.id, tree: match.tree, sort: match.sort };
    const savedMatch = matchSavedView(saved.filters.map((f) => ({ id: f.id, tree: f.filter_tree })), current);
    return savedMatch ?? { id: "all", tree: scopeTree, sort: DEFAULT_SORT };
  }, [builtin, current, scopeTree, saved.filters]);
  const baseline = explicit ?? implicit;

  // A restored filter might equal a saved view: load the list once so it can read as clean.
  const savedLoad = saved.load;
  const needsSavedLookup = !explicit && !saved.loaded && !isEmptyTree(filter.tree) && !matchBuiltinView(builtin, current);
  useEffect(() => {
    if (needsSavedLookup) void savedLoad();
  }, [needsSavedLookup, savedLoad]);
  const dirty = isViewDirty(baseline, current);
  const hasFilters = !isEmptyTree(filter.tree);

  // Tab counts: lazy, after the table has painted, through the table's own scope-aware list
  // endpoint (role / branch / own limits apply). A failed count stays undefined -> no number drawn.
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const countsListId = fieldKeys.has("stage") ? views.applicationsListId : null;
  useEffect(() => {
    if (!countsListId) return;
    const controller = new AbortController();
    void fetchLeadCount({ tree: singleValueTree("stage", countsListId) }, controller.signal).then((n) => {
      if (!controller.signal.aborted) setCounts((prev) => ({ ...prev, applications: n }));
    });
    return () => controller.abort();
  }, [countsListId]);

  function activateView(view: ViewDef) {
    setActiveSaved(null);
    setExplicit(baselineFromState(view.id, { tree: view.tree, sort: view.sort }));
    filter.onChange(view.tree);
    onSortChange(view.sort);
  }

  function applySaved(f: SavedLeadFilter) {
    const { tree: prepared, dropped } = prepareSavedFilterTree(f.filter_tree, views.registry);
    const remaining = prepared.conditions.length + (prepared.groups ?? []).reduce((n, g) => n + g.conditions.length, 0);
    if (remaining === 0) {
      toast.error("This saved view no longer applies to your leads.");
      return;
    }
    if (dropped > 0) toast.info(`${dropped} part${dropped === 1 ? "" : "s"} of this view no longer exist and were skipped.`);
    setActiveSaved({ id: f.id, name: f.name });
    setExplicit(baselineFromState(f.id, { tree: prepared, sort: DEFAULT_SORT }));
    filter.onChange(prepared);
    onSortChange(DEFAULT_SORT);
  }

  function discard() {
    const restored = discardToBaseline(baseline);
    filter.onChange(restored.tree);
    onSortChange(restored.sort);
  }

  async function saveView(name: string): Promise<string | null> {
    const result = await saved.create(name.trim(), filter.tree);
    if ("error" in result) return result.error;
    setExplicit(baselineFromState(result.filter.id, current));
    setActiveSaved({ id: result.filter.id, name: result.filter.name });
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
        <ViewTabs
          views={builtin}
          activeId={baseline.id}
          counts={counts}
          activeSaved={activeSaved}
          onSelect={activateView}
          more={{
            saved: saved.filters,
            savedLoaded: saved.loaded,
            savedLoading: saved.loading,
            loadSaved: saved.load,
            onApplySaved: applySaved,
            onDeleteSaved: async (id) => {
              const err = await saved.remove(id);
              if (!err && activeSaved?.id === id) setActiveSaved(null);
              return err;
            },
            archive: views.archiveSlug ? { slug: views.archiveSlug } : null,
            trash: views.trashSlug ? { slug: views.trashSlug } : null,
            onOpenList: views.onOpenList,
            hasFilters,
            savedViewsEnabled,
            onCreate: saveView,
            activeSavedId: activeSaved?.id ?? null,
          }}
        />
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
          request={filterRequest ?? null}
        />
        <span className="flex-1" />
        {dirty && <UnsavedBar canSave={savedViewsEnabled && hasFilters} onDiscard={discard} onSave={saveView} />}
      </div>
    </div>
  );
}

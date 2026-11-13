"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  PlusIcon,
  CaretDownIcon,
  SlidersHorizontalIcon,
  CaretLeftIcon,
  GearIcon,
  InfoIcon,
  MagnifyingGlassIcon,
} from "@/components/icons";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ApplicationsToolbar } from "../components/applications-toolbar";
import {
  ApplicationsBoard,
  type ColumnPage,
} from "../components/applications-board";
import { ApplicationsList, LIST_POPOVER_COLUMNS, type ListPage } from "../components/applications-list";
import { ColumnsPopover } from "@/components/dashboard/leads/table/columns-popover";
import type { ColumnLayout } from "@/components/dashboard/leads/table/grid-layout";
import { AddApplicationSheet } from "../components/add-application-sheet";
import { ApplicationPipelineSelector } from "../components/pipeline/application-pipeline-selector";
import { ApplicationPipelineSettingsModal } from "../components/pipeline/application-pipeline-settings-modal";
import { CreateApplicationPipelineModal } from "../components/pipeline/create-application-pipeline-modal";
import { IMPLICIT_PIPELINE, defaultPipelineOf } from "../lib/board-placement";
import { DEFAULT_LIST_PAGE_SIZE, type BoardPayload, type ListSummary } from "../lib/board-index";
import { LIST_DEFAULT_KEYS, loadListLayout, loadPageSize, parsePage, resetListLayout, saveListLayout, savePageSize } from "../lib/list-view";
import { resolvePipelineSelection } from "../lib/pipeline-selection";
import { useEmptyStateSlot } from "../hooks/use-empty-state-slot";
import { useBelowMd } from "../hooks/use-below-md";
import { applicationDetailHref, boardStateQuery, decodeApplicationParams, withParam, withPipelineSwitch } from "../lib/applications-url";
import type { BoardTotals } from "../lib/board-data";
import { DEFAULT_APPLICATION_SORT } from "../lib/applications-query";
import { COLUMN_WIDTH_PX, DEFAULT_COLUMN_WIDTH, readColumnWidth, writeColumnWidth, type ColumnWidth } from "../lib/board-view-prefs";
import { applicationFields, APPLICATION_MOST_USED_KEYS } from "@/lib/filters/registry/applications";
import { useAdvancedFilters } from "@/lib/filters/use-advanced-filters";
import { FILTER_PARAM, isEmptyTree } from "@/lib/filters/serialize";
import { countSuffix, sortByCountDesc } from "@/lib/leads/facet-labels";
import type { FilterOption } from "@/components/ui/filter-dropdown";
import type { FieldDef, FilterTree } from "@/lib/filters/types";
import type { Application, ApplicationStage, ApplicationPipelineWithCounts, UserRole } from "@/types/database";

interface ApplicationsWorkspaceTeamMember {
  user_id: string;
  name: string;
  email: string;
}

interface ApplicationsWorkspaceProps {
  stages: ApplicationStage[];
  /** Server columns: first page of cards per expanded column + exact filtered totals (Phase 3). */
  board: BoardPayload<Application>;
  /**
   * Everything that must NOT follow the chips: tab counts, "of T", stage + pipeline totals, filter
   * option lists + per-option counts (board-data.ts).
   */
  totals: BoardTotals;
  /** "That filter couldn't be read" / "Counsellor can't be combined with OR yet" chip text. */
  filterError?: string | null;
  canManageApplications: boolean;
  teamMembers: ApplicationsWorkspaceTeamMember[];
  pipelines?: ApplicationPipelineWithCounts[];
  role: UserRole;
  tenantId: string;
  userId: string;
  /** Tenant timezone: the list's deadline colours (due in 14d / past). */
  timezone?: string;
  /** Visibility scope of this user ("own" = a counsellor's own leads): own scope gets no bulk actions. */
  scopeKind?: "own" | "branch" | "all";
}

type View = "board" | "list";
// Mockup state 6: a ghost 28px button at the right end of the tabs row.
const VIEW_SETTINGS_BTN =
  "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-ds-sm px-2 text-sm font-medium text-ds-ink transition-colors hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ds-ghost data-[state=open]:bg-ds-hover";

export function ApplicationsWorkspace({
  stages: initialStages,
  board,
  totals,
  filterError = null,
  canManageApplications,
  teamMembers,
  pipelines,
  role,
  tenantId,
  userId,
  timezone = "UTC",
  scopeKind = "own",
}: ApplicationsWorkspaceProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const isAdmin = role === "owner" || role === "admin";
  // Behaviour switches below md (sheets, no drag, rows instead of a table). Layout uses max-md: classes.
  const phone = useBelowMd();

  // ?view=list keeps the List view across reloads and the detail back link (Phase 4).
  const view: View = searchParams.get("view") === "list" ? "list" : "board";
  // Server props are the source of truth (router.refresh() must be able to update them).
  const stages = initialStages;
  const allPipelines = useMemo(() => pipelines ?? [], [pipelines]);
  const [addOpen, setAddOpen] = useState(false);
  const [addStageId, setAddStageId] = useState<string | null>(null);
  const [settingsState, setSettingsState] = useState<{ pipelineId: string; addStage: boolean } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // The URL is the source of truth for the selected pipeline; unknown ids fall back to Default.
  const selectedPipelineId = resolvePipelineSelection(searchParams.get("pipeline"), allPipelines);
  const selectedPipeline = allPipelines.find((p) => p.id === selectedPipelineId) ?? null;
  const defaultPipeline = defaultPipelineOf(allPipelines);
  const isDefaultSelected = !!selectedPipeline && selectedPipeline.id === defaultPipeline?.id;

  const handlePipelineChange = useCallback(
    (pipelineId: string) => {
      try {
        localStorage.setItem(`application_pipeline_selected_${tenantId}`, pipelineId);
      } catch {
        /* ignore */
      }
      router.replace(`${pathname}?${withPipelineSwitch(searchParams.toString(), pipelineId)}`, { scroll: false });
    },
    [router, searchParams, pathname, tenantId],
  );

  // No ?pipeline= yet: restore this person's last pipeline (once, on load).
  useEffect(() => {
    if (searchParams.get("pipeline")) return;
    try {
      const saved = localStorage.getItem(`application_pipeline_selected_${tenantId}`);
      if (saved && saved !== defaultPipeline?.id && allPipelines.some((p) => p.id === saved)) {
        router.replace(`${pathname}?${withPipelineSwitch(searchParams.toString(), saved)}`, { scroll: false });
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { tabCounts, stageTotals, pipelineTotals, noPipelineTotal, facets } = totals;

  const filteredStages = useMemo(() => {
    if (selectedPipelineId === IMPLICIT_PIPELINE) {
      return stages.filter((s) => !s.pipeline_id || !allPipelines.some((p) => p.id === s.pipeline_id));
    }
    return stages.filter((s) => s.pipeline_id === selectedPipelineId);
  }, [stages, selectedPipelineId, allPipelines]);


  // ── toolbar state: the URL is the source of truth (?f= ?q= ?sort= ?tab=) ──────────────────────
  const fieldCtx = useMemo(() => ({ tz: "UTC", now: new Date(0), industryId: "education_consultancy", permissions: {} }), []);
  const registry = useMemo(() => applicationFields(fieldCtx), [fieldCtx]);
  const { tree, setTree } = useAdvancedFilters(registry);
  const urlState = useMemo(
    () => decodeApplicationParams({ q: searchParams.get("q") ?? undefined, sort: searchParams.get("sort") ?? undefined, tab: searchParams.get("tab") ?? undefined }, fieldCtx),
    [searchParams, fieldCtx],
  );
  const { q, sort, tab } = urlState;
  const pushParam = useCallback(
    (key: string, value: string | null) => {
      // Any filter / sort / tab change goes back to page 1 of the list.
      const base = key === "page" ? searchParams.toString() : withParam(searchParams.toString(), "page", null);
      const qs = withParam(base, key, value);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );
  const setView = useCallback(
    (v: View) => {
      const base = withParam(searchParams.toString(), "page", null);
      const qs = withParam(base, "view", v === "list" ? "list" : null);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );
  const [columnWidth, setColumnWidth] = useState<ColumnWidth>(DEFAULT_COLUMN_WIDTH);
  // localStorage is read after mount (no SSR mismatch); deferred like the column prefs below.
  useEffect(() => {
    const id = setTimeout(() => setColumnWidth(readColumnWidth(userId)), 0);
    return () => clearTimeout(id);
  }, [userId]);

  const assigneeNames = useMemo(
    () => Object.fromEntries(teamMembers.map((m) => [m.user_id, m.name])),
    [teamMembers],
  );

  // List prefs (per user): column layout under its own grid-prefs key + rows per page. Read after
  // mount (no SSR mismatch), deferred like the column width above.
  const [listLayout, setListLayout] = useState<ColumnLayout>({ keys: LIST_DEFAULT_KEYS, pins: [] });
  const [pageSize, setPageSize] = useState<number>(DEFAULT_LIST_PAGE_SIZE);
  const [prefsReady, setPrefsReady] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => {
      setListLayout(loadListLayout(tenantId, userId));
      setPageSize(loadPageSize(tenantId, userId));
      setPrefsReady(true);
    }, 0);
    return () => clearTimeout(id);
  }, [tenantId, userId]);
  const handleListLayout = useCallback(
    (next: ColumnLayout) => {
      setListLayout(next);
      saveListLayout(tenantId, userId, next);
    },
    [tenantId, userId],
  );

  // Header "N of T": chips or search (T is the same tab with neither).
  const filtersActive = !isEmptyTree(tree) || q !== "";
  // Empty-state choice: anything that narrows the board, the tab included.
  const anythingActive = filtersActive || tab !== "all";
  const pipelineTotal = pipelineTotals[selectedPipelineId] ?? 0;

  const pickerFields = useMemo<FieldDef[]>(
    () => Object.values(registry).filter((f) => f.filterable && !f.hiddenFromPicker),
    [registry],
  );
  // Option lists + per-option counts come from the UNFILTERED board (selected pipeline, all tabs),
  // so a Counsellor chip can't shrink the Country list (fix round 1, M2). Counts ride in the label
  // the Leads way (countSuffix) and the toolbar strips them back out via countSources.
  const optionCtx = useMemo(() => {
    const toMap = (r: Record<string, number>) => new Map(Object.entries(r));
    const counts = {
      counsellor: toMap(facets.counsellor),
      stage: toMap(facets.stage),
      intake: toMap(facets.intake),
      country: toMap(facets.country),
      offer_type: toMap(facets.offer_type),
    };
    const withCount = (key: keyof typeof counts, value: string, label: string) => `${label}${countSuffix(counts[key], value)}`;
    const keysOf = (r: Record<string, number>) => Object.keys(r).sort((a, b) => a.localeCompare(b));
    const people = sortByCountDesc(
      teamMembers.map((m) => ({ value: m.user_id, name: m.name || m.email.split("@")[0], email: m.email })),
      counts.counsellor,
      (m) => m.value,
      (m) => m.name,
    );
    const options: Record<string, FilterOption[]> = {
      counsellor: people.map((m) => ({ value: m.value, label: withCount("counsellor", m.value, m.name), description: m.email })),
      stage: filteredStages.map((st) => ({ value: st.id, label: withCount("stage", st.id, st.name), color: st.color })),
      intake: keysOf(facets.intake).map((v) => ({ value: v, label: withCount("intake", v, v) })),
      country: keysOf(facets.country).map((v) => ({ value: v, label: withCount("country", v, v) })),
    };
    return {
      getOptions: (f: FieldDef): FilterOption[] =>
        options[f.key] ??
        (f.key === "offer_type"
          ? (f.options ?? []).map((o) => ({ value: o.value, label: withCount("offer_type", o.value, o.label) }))
          : f.options?.map((o) => ({ value: o.value, label: o.label })) ?? []),
      countSources: counts,
    };
  }, [facets, filteredStages, teamMembers]);

  // Card/row -> detail carries the board's f/q/sort/tab/pipeline for the in-app back link (B3).
  const boardQuery = searchParams.toString();
  const detailHref = useCallback((appId: string) => applicationDetailHref(appId, boardQuery), [boardQuery]);

  // "Clear filters" on the no-matches state: drops ?f ?q ?tab, keeps ?pipeline (and ?sort).
  const [toolbarKey, setToolbarKey] = useState(0);
  const clearFilters = useCallback(() => {
    const p = new URLSearchParams(searchParams.toString());
    for (const k of [FILTER_PARAM, "q", "tab", "page"]) p.delete(k);
    const qs = p.toString();
    setToolbarKey((k) => k + 1); // the search box keeps its own text; remount it empty
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, searchParams]);

  const handleTreeChange = useCallback((next: FilterTree) => setTree(next, { deleteParams: ["page"] }), [setTree]);
  const handleColumnWidth = useCallback(
    (w: ColumnWidth) => {
      setColumnWidth(w);
      writeColumnWidth(userId, w);
    },
    [userId],
  );

  const handleRefresh = useCallback(() => {
    router.refresh();
  }, [router]);

  const handleCreated = useCallback(() => {
    router.refresh();
  }, [router]);

  const openAdd = useCallback((stageId: string | null) => {
    setAddStageId(stageId);
    setAddOpen(true);
  }, []);

  // ── server paging (Phase 3): the next page of a column / of the list, from the URL state ─────────
  const boardQuery0 = boardStateQuery(searchParams.toString());
  const requestPage = useCallback(
    async (opts: { stage?: string; offset: number; limit: number }): Promise<ColumnPage> => {
      const p = new URLSearchParams(boardQuery0);
      if (opts.stage) p.set("stage", opts.stage);
      p.set("offset", String(opts.offset));
      p.set("limit", String(opts.limit));
      const res = await fetch(`/api/v1/applications/board-page?${p.toString()}`);
      if (!res.ok) throw new Error(`board-page ${res.status}`);
      const { data } = (await res.json()) as { data: ColumnPage };
      return data;
    },
    [boardQuery0],
  );
  const fetchColumnPage = useCallback((stageId: string, offset: number) => requestPage({ stage: stageId, offset, limit: 25 }), [requestPage]);

  // List view (Phase 4): Leads-style pages of the flat filtered index, ?page= in the URL.
  // A page-size change resets to page 1. Until the URL drops ?page=, render page 1 anyway: otherwise
  // the list would briefly see the old page with the new size and clamp it (a racing ?page= write).
  const urlPage = searchParams.get("page");
  const [forcePage1, setForcePage1] = useState(false);
  if (forcePage1 && !urlPage) setForcePage1(false);
  const listPage = forcePage1 ? 1 : parsePage(urlPage);
  const fetchListPage = useCallback(
    async (offset: number, limit: number): Promise<ListPage> => {
      const p = new URLSearchParams(boardQuery0);
      p.set("offset", String(offset));
      p.set("limit", String(limit));
      const res = await fetch(`/api/v1/applications/board-page?${p.toString()}`);
      if (!res.ok) throw new Error(`board-page ${res.status}`);
      const { data } = (await res.json()) as { data: ColumnPage & { summary: ListSummary | null; truncated: boolean } };
      return { rows: data.cards, total: data.total, summary: data.summary, truncated: data.truncated };
    },
    [boardQuery0],
  );
  const handleListPage = useCallback((n: number) => pushParam("page", n <= 1 ? null : String(n)), [pushParam]);
  const handlePageSize = useCallback(
    (n: number) => {
      setPageSize(n);
      savePageSize(tenantId, userId, n);
      if (searchParams.get("page")) setForcePage1(true);
      pushParam("page", null);
    },
    [tenantId, userId, pushParam, searchParams],
  );
  const [filterRequest, setFilterRequest] = useState<{ fieldKey: string; nonce: number } | null>(null);
  const filterFieldKeys = useMemo(() => new Set(pickerFields.map((f) => f.key)), [pickerFields]);
  // Bulk actions are admin-only; counsellors (own scope) never see them (Phase 3 note).
  const bulkAllowed = canManageApplications && scopeKind !== "own";

  const pipelineIsEmpty = board.total === 0;
  // Filtered to zero (chips, search or a tab) -> "No applications match"; the "No applications in
  // this board yet" state is only for a pipeline that is empty with nothing applied. A known-empty
  // pipeline stays the real empty state even under a tab.
  const knownEmptyPipeline = !totals.degraded && pipelineTotal === 0;
  const showNoMatches = pipelineIsEmpty && anythingActive && !knownEmptyPipeline && filteredStages.length > 0;
  const showEmptyPipeline = pipelineIsEmpty && !showNoMatches && filteredStages.length > 0;
  const boardAreaRef = useRef<HTMLDivElement>(null);
  const emptySlot = useEmptyStateSlot(boardAreaRef, view === "board" && (showNoMatches || showEmptyPipeline));
  const settingsPipeline = settingsState ? allPipelines.find((p) => p.id === settingsState.pipelineId) ?? null : null;

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3 max-md:gap-0">
      {/* Header (phone: title, pipeline button, 32px ink "+"; count pill and gear hidden) */}
      <div className="flex items-center gap-2.5 shrink-0 max-md:h-8 max-md:gap-2">
        <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-[#101112]">Applications</h1>
        <span
          data-testid="header-count"
          className="rounded-full bg-[#f6f7f9] px-2 py-0.5 text-[12px] text-[#6b6f76] tabular-nums max-md:hidden"
        >
          {(() => {
            const n = `${board.total.toLocaleString()}${board.truncated ? "+" : ""}`;
            return filtersActive && tabCounts ? `${n} of ${tabCounts[tab].toLocaleString()}${totals.truncated ? "+" : ""}` : n;
          })()}
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-2 max-md:min-w-0">
          <ApplicationPipelineSelector
            pipelines={allPipelines}
            stages={stages}
            stageTotals={stageTotals}
            pipelineCounts={pipelineTotals}
            noPipelineCount={noPipelineTotal}
            selectedPipelineId={selectedPipelineId}
            selectedCount={pipelineTotal}
            isAdmin={isAdmin}
            phone={phone}
            onSelect={handlePipelineChange}
            onOpenSettings={(id) => setSettingsState({ pipelineId: id, addStage: false })}
            onCreate={() => setCreateOpen(true)}
          />
          {isAdmin && selectedPipeline && (
            <button
              type="button"
              title="Pipeline settings"
              aria-label="Pipeline settings"
              onClick={() => setSettingsState({ pipelineId: selectedPipeline.id, addStage: false })}
              className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-[8px] border border-[#e8e9eb] bg-white text-[#2b2d2f] hover:bg-[#f6f7f9] max-md:hidden"
            >
              <GearIcon className="h-[15px] w-[15px]" />
            </button>
          )}
          {canManageApplications && (
            <button
              type="button"
              aria-label="Add application"
              title="Add application"
              data-testid="header-add"
              onClick={() => openAdd(null)}
              className="inline-flex h-[30px] items-center gap-1.5 rounded-[8px] bg-[#0f0f10] px-2.5 text-[13px] font-medium text-white transition-colors hover:bg-[#0f0f10]/90 max-md:size-8 max-md:shrink-0 max-md:justify-center max-md:gap-0 max-md:px-0 max-md:text-[0px]"
            >
              <PlusIcon className="h-3 w-3 shrink-0 max-md:size-[15px]" />
              Add application
            </button>
          )}
        </div>
      </div>

      {/* Toolbar: tabs + search + sort + chips (all URL-backed) */}
      <ApplicationsToolbar
        key={toolbarKey}
        tab={tab}
        tabCounts={tabCounts}
        onTab={(t) => pushParam("tab", t === "all" ? null : t)}
        q={q}
        onSearch={(value) => pushParam("q", value || null)}
        sort={sort}
        onSort={(s2) => pushParam("sort", s2 === DEFAULT_APPLICATION_SORT ? null : s2)}
        fields={pickerFields}
        tree={tree}
        onTreeChange={handleTreeChange}
        optionCtx={optionCtx}
        mostUsedKeys={APPLICATION_MOST_USED_KEYS}
        filterError={filterError}
        columnWidth={columnWidth}
        onColumnWidth={handleColumnWidth}
        view={view}
        onView={setView}
        filterRequest={filterRequest}
        listActions={
          <ColumnsPopover
            trigger={
              <button type="button" data-testid="view-settings" className={VIEW_SETTINGS_BTN}>
                <SlidersHorizontalIcon className="size-4 shrink-0" />
                View settings
                <CaretDownIcon className="size-3.5 shrink-0 text-ds-faint" />
              </button>
            }
            columns={LIST_POPOVER_COLUMNS}
            layout={listLayout}
            titleFor={(c) => c.label}
            onLayoutChange={handleListLayout}
            onReset={() => setListLayout(resetListLayout(tenantId, userId))}
            dndId="applications-list-columns-dnd"
            testId="applications-view-settings"
          />
        }
      />

      {isDefaultSelected && noPipelineTotal > 0 && (
        <div
          data-testid="no-pipeline-note"
          className={`flex shrink-0 items-center gap-2 rounded-[8px] bg-[#fafaf9] px-2.5 py-[7px] text-[12px] text-[#6b6f76] shadow-[0_0_0_1px_rgba(0,0,0,.06)] max-md:mt-2 max-md:h-[30px] max-md:py-0 max-md:whitespace-nowrap${filtersActive ? " max-md:hidden" : ""}`}
        >
          <InfoIcon className="h-[14px] w-[14px] shrink-0 text-[#9a9ea5] max-md:size-[13px]" />
          <span className="min-w-0 truncate md:hidden" data-testid="no-pipeline-note-phone">
            <b className="font-semibold text-[#101112]">{noPipelineTotal}</b> with no pipeline, shown in their stage
          </span>
          <span className="max-md:hidden">
            <b className="font-semibold text-[#101112]">{noPipelineTotal}</b>{" "}
            {noPipelineTotal === 1 ? "application has no pipeline yet — it's" : "applications have no pipeline yet — they're"} shown
            here under Default.
          </span>
        </div>
      )}

      {/* Content */}
      {view === "board" ? (
        <div ref={boardAreaRef} className="relative flex-1 min-h-0 overflow-hidden max-md:flex-none max-md:overflow-visible">
          <ApplicationsBoard
            key={selectedPipelineId}
            stages={filteredStages}
            board={board}
            fetchPage={fetchColumnPage}
            stageTotals={stageTotals}
            pipelineId={selectedPipelineId}
            userId={userId}
            canManageApplications={canManageApplications}
            isAdmin={isAdmin && !!selectedPipeline}
            onRefresh={handleRefresh}
            onAddToStage={openAdd}
            onEditStages={(opts) =>
              selectedPipeline && setSettingsState({ pipelineId: selectedPipeline.id, addStage: !!opts?.addStage })
            }
            assigneeNames={assigneeNames}
            columnWidth={COLUMN_WIDTH_PX[columnWidth]}
            detailHref={detailHref}
            phone={phone}
          />
          {showNoMatches && (
            <div
              data-testid="no-matches"
              style={emptySlot}
              className="pointer-events-none absolute inset-x-0 flex flex-col items-center overflow-y-auto text-center max-md:static max-md:px-6 max-md:pt-14"
            >
              <div className="mb-3.5 flex h-[120px] w-[120px] items-center justify-center rounded-[20px] bg-[#f3f4f6] max-md:size-[96px] max-md:rounded-[18px]">
                <MagnifyingGlassIcon className="h-9 w-9 text-[#9a9ea5] max-md:size-7" />
              </div>
              <h3 className="mb-1 text-[18px] font-semibold text-[#101112] max-md:text-[17px]">No applications match these filters</h3>
              <p className="mb-3.5 max-w-[340px] text-[13px] text-[#6b6f76]">
                Try removing a filter, or check the spelling of your search.
              </p>
              <div className="pointer-events-auto flex gap-2">
                <button
                  type="button"
                  data-testid="no-matches-clear"
                  onClick={clearFilters}
                  className="inline-flex h-[30px] items-center gap-1.5 rounded-[8px] border border-[#e8e9eb] bg-white px-2.5 text-[13px] font-medium text-[#2b2d2f] hover:bg-[#f6f7f9]"
                >
                  Clear filters
                </button>
              </div>
            </div>
          )}
          {showEmptyPipeline && (
            <div
              data-testid="empty-pipeline"
              style={emptySlot}
              className="pointer-events-none absolute inset-x-0 flex flex-col items-center overflow-y-auto text-center max-md:static max-md:px-6 max-md:pt-14"
            >
              <div className="mb-3.5 flex h-[120px] w-[120px] items-center justify-center rounded-[20px] bg-[#f3f4f6] max-md:size-[96px] max-md:rounded-[18px]">
                <div className="flex h-[84px] w-[72px] max-md:h-[68px] max-md:w-[58px] max-md:gap-1.5 max-md:rounded-[12px] max-md:p-[11px_10px] flex-col gap-[7px] rounded-[14px] bg-white p-[14px_12px] shadow-[0_0_0_1px_#e3e4e7,0_2px_6px_rgba(0,0,0,.05)]">
                  <i className="block h-1.5 rounded-[3px] bg-[#e6e7ea]" />
                  <i className="block h-1.5 w-3/4 rounded-[3px] bg-[#e6e7ea]" />
                  <i className="block h-1.5 w-1/2 rounded-[3px] bg-[#e6e7ea]" />
                </div>
              </div>
              <h3 className="mb-1 text-[18px] font-semibold text-[#101112]">
                No applications in {selectedPipeline?.name ?? "this board"} yet
              </h3>
              <p className="mb-3.5 max-w-[340px] text-[13px] text-[#6b6f76]">
                Add an application, or move one here from another pipeline.
              </p>
              <div className="pointer-events-auto flex gap-2">
                {!isDefaultSelected && defaultPipeline && (
                  <button
                    type="button"
                    onClick={() => handlePipelineChange(defaultPipeline.id)}
                    className="inline-flex h-[30px] items-center gap-1.5 rounded-[8px] border border-[#e8e9eb] bg-white px-2.5 text-[13px] font-medium text-[#2b2d2f] hover:bg-[#f6f7f9]"
                  >
                    <CaretLeftIcon className="h-3 w-3" />
                    Back to Default pipeline
                  </button>
                )}
                {canManageApplications && (
                  <button
                    type="button"
                    onClick={() => openAdd(null)}
                    className="inline-flex h-[30px] items-center gap-1.5 rounded-[8px] bg-[#0f0f10] px-2.5 text-[13px] font-medium text-white hover:bg-[#0f0f10]/90"
                  >
                    <PlusIcon className="h-3 w-3" />
                    Add application
                  </button>
                )}
              </div>
            </div>
          )}
          {pipelineIsEmpty && filteredStages.length === 0 && (
            <div data-testid="no-pipeline-setup" className="flex h-full flex-col items-center justify-center text-center">
              <h3 className="mb-1 text-[18px] font-semibold text-[#101112]">No applications yet</h3>
              <p className="mb-3.5 max-w-[340px] text-[13px] text-[#6b6f76]">
                {isAdmin ? "Set up a pipeline to start tracking applications." : "Ask an admin to set up a pipeline."}
              </p>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="inline-flex h-[30px] items-center gap-1.5 rounded-[8px] bg-[#0f0f10] px-2.5 text-[13px] font-medium text-white hover:bg-[#0f0f10]/90"
                >
                  <PlusIcon className="h-3 w-3" />
                  Set up a pipeline
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col -mx-0" data-testid="list-area">
          {prefsReady && (
            <ApplicationsList
              key={selectedPipelineId}
              stateQuery={boardQuery0}
              fetchPage={fetchListPage}
              page={listPage}
              pageSize={pageSize}
              onPage={handleListPage}
              onPageSize={handlePageSize}
              layout={listLayout}
              onLayoutChange={handleListLayout}
              sort={sort}
              onSort={(s2) => pushParam("sort", s2 === DEFAULT_APPLICATION_SORT ? null : s2)}
              onFilterRequest={(fieldKey) => setFilterRequest({ fieldKey, nonce: Date.now() })}
              filterFieldKeys={filterFieldKeys}
              stages={filteredStages}
              teamMembers={teamMembers}
              assigneeNames={assigneeNames}
              canManageApplications={canManageApplications}
              bulkAllowed={bulkAllowed}
              timezone={timezone}
              detailHref={detailHref}
              filtersActive={anythingActive}
              onClearFilters={clearFilters}
              onChanged={handleRefresh}
            />
          )}
        </div>
      )}

      <AddApplicationSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        stages={stages}
        canManageApplications={canManageApplications}
        onSuccess={handleCreated}
        initialStageId={addStageId}
      />


      {isAdmin && settingsPipeline && (
        <ApplicationPipelineSettingsModal
          open
          onClose={() => {
            setSettingsState(null);
            router.refresh();
          }}
          pipeline={settingsPipeline}
          stages={stages.filter((s) => s.pipeline_id === settingsPipeline.id)}
          stageAppCounts={stageTotals}
          startAddingStage={settingsState?.addStage}
          key={settingsPipeline.id}
        />
      )}

      {isAdmin && (
        <CreateApplicationPipelineModal
          open={createOpen}
          onClose={(newId) => {
            setCreateOpen(false);
            if (newId) handlePipelineChange(newId);
            else router.refresh();
          }}
          pipelines={allPipelines}
        />
      )}
    </div>
  );
}

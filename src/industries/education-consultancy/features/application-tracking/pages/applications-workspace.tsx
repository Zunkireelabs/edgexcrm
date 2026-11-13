"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import {
  PlusIcon,
  SquaresFourIcon,
  ListIcon,
  MagnifyingGlassIcon,
  ArrowsDownUpIcon,
  ColumnsIcon,
  GearIcon,
  InfoIcon,
} from "@/components/icons";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FilterDropdown } from "@/components/ui/filter-dropdown";
import {
  ApplicationsFilterMenu,
  ApplicationsFilterChips,
  type ApplicationsFilterField,
} from "../components/applications-filter-menu";
import {
  ApplicationsColumnManager,
} from "../components/applications-column-manager";
import {
  ApplicationsBoard,
} from "../components/applications-board";
import {
  ApplicationsTable,
  APPLICATION_COLUMNS,
  APPLICATION_DEFAULT_COLUMN_KEYS,
} from "../components/applications-table";
import { AddApplicationSheet } from "../components/add-application-sheet";
import { ApplicationPipelineSelector } from "../components/pipeline/application-pipeline-selector";
import { ApplicationPipelineSettingsModal } from "../components/pipeline/application-pipeline-settings-modal";
import { CreateApplicationPipelineModal } from "../components/pipeline/create-application-pipeline-modal";
import {
  IMPLICIT_PIPELINE,
  appsOnPipeline,
  defaultPipelineOf,
  resolveBoardPlacement,
} from "../lib/board-placement";
import { resolvePipelineSelection, withPipelineParam } from "../lib/pipeline-selection";
import type { Application, ApplicationStage, ApplicationPipelineWithCounts, UserRole } from "@/types/database";
import { normalizeDestinations } from "@/lib/leads/destination-normalize";

interface ApplicationsWorkspaceTeamMember {
  user_id: string;
  name: string;
  email: string;
}

interface ApplicationsWorkspaceProps {
  stages: ApplicationStage[];
  applications: Application[];
  canManageApplications: boolean;
  teamMembers: ApplicationsWorkspaceTeamMember[];
  pipelines?: ApplicationPipelineWithCounts[];
  role: UserRole;
  tenantId: string;
  userId: string;
}

type View = "board" | "list";
type SortField = "created_at" | "updated_at" | "university_name" | "application_deadline";
type SortDir = "asc" | "desc";

const SORT_OPTIONS = [
  { value: "created_at:desc", label: "Newest first" },
  { value: "created_at:asc", label: "Oldest first" },
  { value: "updated_at:desc", label: "Recently updated" },
  { value: "university_name:asc", label: "University A–Z" },
  { value: "university_name:desc", label: "University Z–A" },
  { value: "application_deadline:asc", label: "Deadline (soonest)" },
  { value: "application_deadline:desc", label: "Deadline (latest)" },
];

// Applications-only toolbar button style — deliberately duplicated from Leads'
// TOOLBAR_BTN rather than shared, so the two pages can never affect each other.
const TOOLBAR_BTN =
  "inline-flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded-[8px] border transition-colors border-gray-300 bg-white text-gray-600 hover:bg-[#0000170b]";

const COLUMNS_STORAGE_KEY = "edgex-applications-visible-columns";

export function ApplicationsWorkspace({
  stages: initialStages,
  applications: initialApplications,
  canManageApplications,
  teamMembers,
  pipelines,
  role,
  tenantId,
  userId,
}: ApplicationsWorkspaceProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const isAdmin = role === "owner" || role === "admin";

  const [view, setView] = useState<View>("board");
  // Server props are the source of truth (router.refresh() must be able to update them).
  const stages = initialStages;
  const applications = initialApplications;
  const allPipelines = useMemo(() => pipelines ?? [], [pipelines]);
  const [addOpen, setAddOpen] = useState(false);
  const [addStageId, setAddStageId] = useState<string | null>(null);
  const [columnDialogOpen, setColumnDialogOpen] = useState(false);
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<string[]>(APPLICATION_DEFAULT_COLUMN_KEYS);
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
      router.replace(`${pathname}?${withPipelineParam(searchParams.toString(), pipelineId)}`, { scroll: false });
    },
    [router, searchParams, pathname, tenantId],
  );

  // No ?pipeline= yet: restore this person's last pipeline (once, on load).
  useEffect(() => {
    if (searchParams.get("pipeline")) return;
    try {
      const saved = localStorage.getItem(`application_pipeline_selected_${tenantId}`);
      if (saved && saved !== defaultPipeline?.id && allPipelines.some((p) => p.id === saved)) {
        router.replace(`${pathname}?${withPipelineParam(searchParams.toString(), saved)}`, { scroll: false });
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { placements, noPipelineCount } = useMemo(
    () => resolveBoardPlacement(applications, stages, allPipelines),
    [applications, stages, allPipelines],
  );

  const filteredStages = useMemo(() => {
    if (selectedPipelineId === IMPLICIT_PIPELINE) {
      return stages.filter((s) => !s.pipeline_id || !allPipelines.some((p) => p.id === s.pipeline_id));
    }
    return stages.filter((s) => s.pipeline_id === selectedPipelineId);
  }, [stages, selectedPipelineId, allPipelines]);

  const pipelineApplications = useMemo(
    () => appsOnPipeline(applications, placements, selectedPipelineId),
    [applications, placements, selectedPipelineId],
  );

  const stageTotals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const a of applications) {
      const sid = placements.get(a.id)?.stageId;
      if (sid) t[sid] = (t[sid] ?? 0) + 1;
    }
    return t;
  }, [applications, placements]);

  const [search, setSearch] = useState("");
  // Stage filter belongs to the pipeline it was picked on, so it never leaks into another pipeline.
  const [stageFilterState, setStageFilterState] = useState({ pipelineId: selectedPipelineId, value: "all" });
  const stageFilter = stageFilterState.pipelineId === selectedPipelineId ? stageFilterState.value : "all";
  const setStageFilter = useCallback(
    (value: string) => setStageFilterState({ pipelineId: selectedPipelineId, value }),
    [selectedPipelineId],
  );
  const [countryFilter, setCountryFilter] = useState("all");
  const [createdByFilter, setCreatedByFilter] = useState<string[]>([]);
  const [sortValue, setSortValue] = useState("created_at:desc");
  const [sortField, sortDir] = sortValue.split(":") as [SortField, SortDir];

  const memberMap = useMemo(
    () => new Map(teamMembers.map((m) => [m.user_id, m])),
    [teamMembers],
  );

  const assigneeNames = useMemo(
    () => Object.fromEntries(teamMembers.map((m) => [m.user_id, m.name])),
    [teamMembers],
  );

  // Load saved column prefs after mount to avoid SSR hydration mismatch.
  // Why: react-hooks/set-state-in-effect rejects synchronous setState inside an
  // effect body; deferring via setTimeout places the update outside the
  // synchronous effect execution (matches tag-multi-picker.tsx's convention).
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(COLUMNS_STORAGE_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as string[];
          const valid = saved.filter((k) => APPLICATION_DEFAULT_COLUMN_KEYS.includes(k));
          if (valid.length > 0) setVisibleColumnKeys(valid);
        }
      } catch {
        // localStorage unavailable or corrupt — keep defaults
      }
    }, 0);
    return () => clearTimeout(id);
  }, []);

  function handleColumnsApply(keys: string[]) {
    setVisibleColumnKeys(keys);
    try {
      window.localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(keys));
    } catch {
      // localStorage unavailable — ignore
    }
  }

  const stageOptions = useMemo(() => [
    { value: "all", label: "All stages" },
    ...filteredStages.map((s) => ({ value: s.id, label: s.name })),
  ], [filteredStages]);

  const countryOptions = useMemo(() => {
    const countries = normalizeDestinations(pipelineApplications.flatMap((a) => a.countries ?? []));
    return [
      { value: "all", label: "All countries" },
      ...countries.map((c) => ({ value: c, label: c })),
    ];
  }, [pipelineApplications]);

  // Per-creator counts — cross-filtered: reflects Stage + Country but deliberately
  // excludes Created By itself, so selecting a person never collapses everyone
  // else's count to 0 (same convention as Leads' "Assigned To" counselorCounts).
  const createdByCounts = useMemo(() => {
    const m = new Map<string, number>();
    pipelineApplications.forEach((a) => {
      const matchesStage = stageFilter === "all" || placements.get(a.id)?.stageId === stageFilter;
      const matchesCountry = countryFilter === "all" || normalizeDestinations(a.countries ?? []).includes(countryFilter);
      if (matchesStage && matchesCountry) {
        const key = a.created_by ?? "unknown";
        m.set(key, (m.get(key) ?? 0) + 1);
      }
    });
    return m;
  }, [pipelineApplications, placements, stageFilter, countryFilter]);

  // Only creators actually present in the data (same principle as countryOptions) —
  // avoids listing every tenant member when most have created zero applications.
  const createdByOptions = useMemo(() => {
    const creatorIds = Array.from(new Set(pipelineApplications.map((a) => a.created_by).filter((v): v is string => !!v)));
    const known = creatorIds
      .filter((id) => (createdByCounts.get(id) ?? 0) > 0)
      .map((id) => {
        const member = memberMap.get(id);
        const name = member?.name || member?.email?.split("@")[0] || "Unknown";
        const email = member?.email ?? "";
        return {
          value: id,
          label: `${name} (${createdByCounts.get(id) ?? 0})`,
          description: email,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
    const unknownCount = createdByCounts.get("unknown") ?? 0;
    return unknownCount > 0
      ? [...known, { value: "unknown", label: `Unknown (${unknownCount})`, description: "No creator recorded" }]
      : known;
  }, [pipelineApplications, createdByCounts, memberMap]);

  const filteredApplications = useMemo(() => {
    let result = pipelineApplications;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter((a) =>
        a.university_name.toLowerCase().includes(q) ||
        a.program_name.toLowerCase().includes(q)
      );
    }
    if (stageFilter !== "all") result = result.filter((a) => placements.get(a.id)?.stageId === stageFilter);
    if (countryFilter !== "all") result = result.filter((a) => normalizeDestinations(a.countries ?? []).includes(countryFilter));
    if (createdByFilter.length > 0) {
      result = result.filter((a) => createdByFilter.includes(a.created_by ?? "unknown"));
    }

    result = [...result].sort((a, b) => {
      let aVal: string | null = null;
      let bVal: string | null = null;

      if (sortField === "university_name") {
        aVal = a.university_name.toLowerCase();
        bVal = b.university_name.toLowerCase();
      } else if (sortField === "application_deadline") {
        aVal = a.application_deadline ?? "";
        bVal = b.application_deadline ?? "";
      } else if (sortField === "updated_at") {
        aVal = a.updated_at;
        bVal = b.updated_at;
      } else {
        aVal = a.created_at;
        bVal = b.created_at;
      }

      const cmp = (aVal ?? "") < (bVal ?? "") ? -1 : (aVal ?? "") > (bVal ?? "") ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });

    return result;
  }, [pipelineApplications, placements, search, stageFilter, countryFilter, createdByFilter, sortField, sortDir]);

  // Scoped to Stage + Country + Created By — Search stays independent so clearing
  // filters never unexpectedly wipes out what the user typed in the search box.
  const activeFieldFilterCount = [
    stageFilter !== "all" ? 1 : 0,
    countryFilter !== "all" ? 1 : 0,
    createdByFilter.length > 0 ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  const clearFieldFilters = () => {
    setStageFilter("all");
    setCountryFilter("all");
    setCreatedByFilter([]);
  };

  const filterFields: ApplicationsFilterField[] = [
    {
      id: "stage",
      label: "Stage",
      value: stageFilter,
      onChange: setStageFilter,
      options: stageOptions,
    },
    {
      id: "createdBy",
      label: "Created By",
      multiple: true,
      value: createdByFilter,
      onChange: setCreatedByFilter,
      options: createdByOptions,
    },
    {
      id: "country",
      label: "Country",
      value: countryFilter,
      onChange: setCountryFilter,
      options: countryOptions,
      searchable: false,
    },
  ];

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

  const pipelineIsEmpty = pipelineApplications.length === 0;
  const settingsPipeline = settingsState ? allPipelines.find((p) => p.id === settingsState.pipelineId) ?? null : null;

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3">
      {/* Header */}
      <div className="flex items-center gap-2.5 shrink-0">
        <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-[#101112]">Applications</h1>
        <span
          data-testid="header-count"
          className="rounded-full bg-[#f6f7f9] px-2 py-0.5 text-[12px] text-[#6b6f76] tabular-nums"
        >
          {filteredApplications.length}
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <ApplicationPipelineSelector
            pipelines={allPipelines}
            stages={stages}
            stageTotals={stageTotals}
            selectedPipelineId={selectedPipelineId}
            selectedCount={filteredApplications.length}
            isAdmin={isAdmin}
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
              className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-[8px] border border-[#e8e9eb] bg-white text-[#2b2d2f] hover:bg-[#f6f7f9]"
            >
              <GearIcon className="h-[15px] w-[15px]" />
            </button>
          )}
          {canManageApplications && (
            <button
              type="button"
              onClick={() => openAdd(null)}
              className="inline-flex h-[30px] items-center gap-1.5 rounded-[8px] bg-[#0f0f10] px-2.5 text-[13px] font-medium text-white transition-colors hover:bg-[#0f0f10]/90"
            >
              <PlusIcon className="h-3 w-3 shrink-0" />
              Add application
            </button>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="shrink-0">
        <div className="flex flex-wrap items-center gap-2 py-1">
          <div className="relative w-52">
            <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search university / program..."
              className="w-full h-7 pl-7 pr-3 rounded-[8px] border border-gray-300 bg-white text-xs text-gray-600 placeholder:text-gray-400 outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {view === "list" && (
            <button type="button" onClick={() => setColumnDialogOpen(true)} className={TOOLBAR_BTN}>
              <ColumnsIcon className="h-3 w-3 shrink-0" />
              Edit columns
            </button>
          )}

          <button
            type="button"
            onClick={() => setView(view === "board" ? "list" : "board")}
            className={TOOLBAR_BTN}
          >
            {view === "board" ? (
              <ListIcon className="h-3 w-3 shrink-0" />
            ) : (
              <SquaresFourIcon className="h-3 w-3 shrink-0" />
            )}
            {view === "board" ? "List view" : "Board view"}
          </button>

          <div className="flex-1" />

          <ApplicationsFilterMenu
            fields={filterFields}
            activeCount={activeFieldFilterCount}
            onClearAll={clearFieldFilters}
          />

          <FilterDropdown
            label="Sort"
            value={sortValue}
            onChange={setSortValue}
            options={SORT_OPTIONS}
            icon={<ArrowsDownUpIcon className="h-3 w-3" />}
            searchable={false}
          />
        </div>

        {activeFieldFilterCount > 0 && (
          <ApplicationsFilterChips fields={filterFields} onClearAll={clearFieldFilters} />
        )}
      </div>

      {isDefaultSelected && noPipelineCount > 0 && (
        <div
          data-testid="no-pipeline-note"
          className="flex shrink-0 items-center gap-2 rounded-[8px] bg-[#fafaf9] px-2.5 py-[7px] text-[12px] text-[#6b6f76] shadow-[0_0_0_1px_rgba(0,0,0,.06)]"
        >
          <InfoIcon className="h-[14px] w-[14px] shrink-0 text-[#9a9ea5]" />
          <span>
            <b className="font-semibold text-[#101112]">{noPipelineCount}</b> applications have no pipeline yet — they&apos;re
            shown here under Default.
          </span>
        </div>
      )}

      {/* Content */}
      {view === "board" ? (
        <div className="relative flex-1 min-h-0 overflow-hidden">
          <ApplicationsBoard
            key={selectedPipelineId}
            stages={filteredStages}
            applications={filteredApplications}
            placements={placements}
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
          />
          {pipelineIsEmpty && filteredStages.length > 0 && (
            <div
              data-testid="empty-pipeline"
              className="pointer-events-none absolute inset-x-0 top-[170px] flex flex-col items-center text-center"
            >
              <div className="mb-3.5 flex h-[120px] w-[120px] items-center justify-center rounded-[20px] bg-[#f3f4f6]">
                <div className="flex h-[84px] w-[72px] flex-col gap-[7px] rounded-[14px] bg-white p-[14px_12px] shadow-[0_0_0_1px_#e3e4e7,0_2px_6px_rgba(0,0,0,.05)]">
                  <i className="block h-1.5 rounded-[3px] bg-[#e6e7ea]" />
                  <i className="block h-1.5 w-3/4 rounded-[3px] bg-[#e6e7ea]" />
                  <i className="block h-1.5 w-1/2 rounded-[3px] bg-[#e6e7ea]" />
                </div>
              </div>
              <h3 className="mb-1 text-[18px] font-semibold text-[#101112]">
                No applications in {selectedPipeline?.name ?? "this board"} yet
              </h3>
              <p className="mb-3.5 max-w-[340px] text-[13px] text-[#6b6f76]">
                Applications you add or move here will show up in their stage.
              </p>
              <div className="pointer-events-auto flex gap-2">
                {!isDefaultSelected && defaultPipeline && (
                  <button
                    type="button"
                    onClick={() => handlePipelineChange(defaultPipeline.id)}
                    className="inline-flex h-[30px] items-center rounded-[8px] border border-[#e8e9eb] bg-white px-2.5 text-[13px] font-medium text-[#2b2d2f] hover:bg-[#f6f7f9]"
                  >
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
        <div className="flex-1 min-h-0 overflow-y-auto">
          <ApplicationsTable
            applications={filteredApplications}
            stages={filteredStages}
            visibleKeys={visibleColumnKeys}
          />
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

      <ApplicationsColumnManager
        open={columnDialogOpen}
        onOpenChange={setColumnDialogOpen}
        columns={APPLICATION_COLUMNS}
        visibleKeys={visibleColumnKeys}
        defaultKeys={APPLICATION_DEFAULT_COLUMN_KEYS}
        onApply={handleColumnsApply}
      />

      {isAdmin && settingsPipeline && (
        <ApplicationPipelineSettingsModal
          open
          onClose={() => {
            setSettingsState(null);
            router.refresh();
          }}
          pipeline={settingsPipeline}
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

"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { Plus, LayoutGrid, List, Search, ArrowUpDown, Columns3 } from "lucide-react";
import { useRouter } from "next/navigation";
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
import type { Application, ApplicationStage } from "@/types/database";

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
}: ApplicationsWorkspaceProps) {
  const router = useRouter();

  const [view, setView] = useState<View>("board");
  const [stages] = useState<ApplicationStage[]>(initialStages);
  const [applications] = useState<Application[]>(initialApplications);
  const [addOpen, setAddOpen] = useState(false);
  const [columnDialogOpen, setColumnDialogOpen] = useState(false);
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<string[]>(APPLICATION_DEFAULT_COLUMN_KEYS);

  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [countryFilter, setCountryFilter] = useState("all");
  const [createdByFilter, setCreatedByFilter] = useState<string[]>([]);
  const [sortValue, setSortValue] = useState("created_at:desc");
  const [sortField, sortDir] = sortValue.split(":") as [SortField, SortDir];

  const memberMap = useMemo(
    () => new Map(teamMembers.map((m) => [m.user_id, m])),
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
    ...stages.map((s) => ({ value: s.id, label: s.name })),
  ], [stages]);

  const countryOptions = useMemo(() => {
    const countries = Array.from(new Set(applications.flatMap((a) => a.countries ?? [])));
    return [
      { value: "all", label: "All countries" },
      ...countries.map((c) => ({ value: c, label: c })),
    ];
  }, [applications]);

  // Per-creator counts — cross-filtered: reflects Stage + Country but deliberately
  // excludes Created By itself, so selecting a person never collapses everyone
  // else's count to 0 (same convention as Leads' "Assigned To" counselorCounts).
  const createdByCounts = useMemo(() => {
    const m = new Map<string, number>();
    applications.forEach((a) => {
      const matchesStage = stageFilter === "all" || a.stage_id === stageFilter;
      const matchesCountry = countryFilter === "all" || (a.countries ?? []).includes(countryFilter);
      if (matchesStage && matchesCountry) {
        const key = a.created_by ?? "unknown";
        m.set(key, (m.get(key) ?? 0) + 1);
      }
    });
    return m;
  }, [applications, stageFilter, countryFilter]);

  // Only creators actually present in the data (same principle as countryOptions) —
  // avoids listing every tenant member when most have created zero applications.
  const createdByOptions = useMemo(() => {
    const creatorIds = Array.from(new Set(applications.map((a) => a.created_by).filter((v): v is string => !!v)));
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
  }, [applications, createdByCounts, memberMap]);

  const filteredApplications = useMemo(() => {
    let result = applications;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter((a) =>
        a.university_name.toLowerCase().includes(q) ||
        a.program_name.toLowerCase().includes(q)
      );
    }
    if (stageFilter !== "all") result = result.filter((a) => a.stage_id === stageFilter);
    if (countryFilter !== "all") result = result.filter((a) => (a.countries ?? []).includes(countryFilter));
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
  }, [applications, search, stageFilter, countryFilter, createdByFilter, sortField, sortDir]);

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

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3">
      {/* Header */}
      <div className="shrink-0">
        <h1 className="text-xl font-bold">Applications</h1>
      </div>

      {/* Toolbar */}
      <div className="shrink-0">
        <div className="flex flex-wrap items-center gap-2 p-3">
          <div className="text-sm font-medium text-muted-foreground shrink-0">
            {applications.length} Application{applications.length !== 1 ? "s" : ""}
          </div>

          <div className="relative w-52">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
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
              <Columns3 className="h-3 w-3 shrink-0" />
              Edit columns
            </button>
          )}

          <button
            type="button"
            onClick={() => setView(view === "board" ? "list" : "board")}
            className={TOOLBAR_BTN}
          >
            {view === "board" ? (
              <List className="h-3 w-3 shrink-0" />
            ) : (
              <LayoutGrid className="h-3 w-3 shrink-0" />
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
            icon={<ArrowUpDown className="h-3 w-3" />}
            searchable={false}
          />

          {canManageApplications && (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded-[8px] transition-colors bg-[#0f0f10] text-white hover:bg-[#0f0f10]/90"
            >
              <Plus className="h-3 w-3 shrink-0" />
              Add Application
            </button>
          )}
        </div>

        {activeFieldFilterCount > 0 && (
          <ApplicationsFilterChips fields={filterFields} onClearAll={clearFieldFilters} />
        )}
      </div>

      {/* Content */}
      {view === "board" ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <ApplicationsBoard
            stages={stages}
            applications={filteredApplications}
            canManageApplications={canManageApplications}
            onRefresh={handleRefresh}
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <ApplicationsTable
            applications={filteredApplications}
            stages={stages}
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
      />

      <ApplicationsColumnManager
        open={columnDialogOpen}
        onOpenChange={setColumnDialogOpen}
        columns={APPLICATION_COLUMNS}
        visibleKeys={visibleColumnKeys}
        defaultKeys={APPLICATION_DEFAULT_COLUMN_KEYS}
        onApply={handleColumnsApply}
      />
    </div>
  );
}

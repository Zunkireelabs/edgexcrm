"use client";

import { useState, useMemo, useCallback } from "react";
import { Plus, LayoutGrid, List, Search, X, ArrowUpDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FilterDropdown } from "@/components/ui/filter-dropdown";
import { ApplicationsBoard } from "../components/applications-board";
import { ApplicationsTable } from "../components/applications-table";
import { AddApplicationSheet } from "../components/add-application-sheet";
import type { Application, ApplicationStage, UserRole } from "@/types/database";

interface ApplicationsWorkspaceProps {
  role: UserRole;
  stages: ApplicationStage[];
  applications: Application[];
  canManageApplications: boolean;
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

export function ApplicationsWorkspace({
  role,
  stages: initialStages,
  applications: initialApplications,
  canManageApplications,
}: ApplicationsWorkspaceProps) {
  const router = useRouter();

  const [view, setView] = useState<View>("board");
  const [stages] = useState<ApplicationStage[]>(initialStages);
  const [applications] = useState<Application[]>(initialApplications);
  const [addOpen, setAddOpen] = useState(false);

  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [countryFilter, setCountryFilter] = useState("all");
  const [sortValue, setSortValue] = useState("created_at:desc");
  const [sortField, sortDir] = sortValue.split(":") as [SortField, SortDir];

  const stageOptions = useMemo(() => [
    { value: "all", label: "All stages" },
    ...stages.map((s) => ({ value: s.id, label: s.name })),
  ], [stages]);

  const countryOptions = useMemo(() => {
    const countries = Array.from(new Set(applications.map((a) => a.country).filter(Boolean))) as string[];
    return [
      { value: "all", label: "All countries" },
      ...countries.map((c) => ({ value: c, label: c })),
    ];
  }, [applications]);

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
    if (countryFilter !== "all") result = result.filter((a) => a.country === countryFilter);

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
  }, [applications, search, stageFilter, countryFilter, sortField, sortDir]);

  const activeFilterCount = [
    search ? 1 : 0,
    stageFilter !== "all" ? 1 : 0,
    countryFilter !== "all" ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  const clearFilters = () => {
    setSearch("");
    setStageFilter("all");
    setCountryFilter("all");
  };

  const handleRefresh = useCallback(() => {
    router.refresh();
  }, [router]);

  const handleCreated = useCallback(() => {
    router.refresh();
  }, [router]);

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-xl font-bold">Applications</h1>
          <p className="text-sm text-muted-foreground">
            {applications.length} application{applications.length !== 1 ? "s" : ""}
          </p>
        </div>
        {canManageApplications && (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Add Application
          </Button>
        )}
      </div>

      {/* Filter toolbar */}
      <div className="flex flex-wrap items-center gap-2 shrink-0 bg-card border rounded-lg px-3 py-2">
        <div className="relative w-52">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search university / program..."
            className="w-full h-7 pl-7 pr-3 rounded-md border border-input bg-background text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <FilterDropdown
          label="Stage"
          value={stageFilter}
          onChange={setStageFilter}
          options={stageOptions}
        />

        <FilterDropdown
          label="Country"
          value={countryFilter}
          onChange={setCountryFilter}
          options={countryOptions}
          searchable={false}
        />

        {activeFilterCount > 0 && (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex items-center gap-1 h-7 px-2 text-xs text-muted-foreground hover:text-foreground rounded-md border border-dashed border-muted-foreground/40 hover:border-foreground/40 transition-colors"
          >
            <X className="h-3 w-3" />
            Clear ({activeFilterCount})
          </button>
        )}

        <div className="flex-1" />

        <FilterDropdown
          label="Sort"
          value={sortValue}
          onChange={setSortValue}
          options={SORT_OPTIONS}
          icon={<ArrowUpDown className="h-3 w-3" />}
          searchable={false}
        />

        <div className="flex rounded-md border overflow-hidden">
          <button
            type="button"
            onClick={() => setView("board")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
              view === "board" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted text-muted-foreground"
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Board
          </button>
          <button
            type="button"
            onClick={() => setView("list")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-l transition-colors ${
              view === "list" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted text-muted-foreground"
            }`}
          >
            <List className="h-3.5 w-3.5" />
            List
          </button>
        </div>
      </div>

      {/* Content */}
      {view === "board" ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <ApplicationsBoard
            stages={stages}
            applications={filteredApplications}
            role={role}
            canManageApplications={canManageApplications}
            onRefresh={handleRefresh}
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <ApplicationsTable applications={filteredApplications} stages={stages} />
        </div>
      )}

      <AddApplicationSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        stages={stages}
        canManageApplications={canManageApplications}
        onSuccess={handleCreated}
      />
    </div>
  );
}

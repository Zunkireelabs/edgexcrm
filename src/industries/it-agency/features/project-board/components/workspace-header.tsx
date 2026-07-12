"use client";

import { useRef, useEffect } from "react";
import { Search, LayoutGrid, TableProperties } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type FilterOption } from "@/components/ui/filter-dropdown";
import { FilterMenu, FilterChips, type FilterDef } from "@/components/ui/filter-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { Account, ProjectStatus } from "@/types/database";
import type { TeamMember } from "../hooks/use-projects";
import type { WorkspaceFilters } from "../hooks/use-workspace-filters";
import { ALL_SENTINEL, STATUS_CHIPS, CANCELLED_CHIP } from "../lib/filter-options";

interface WorkspaceHeaderProps {
  filters: WorkspaceFilters;
  onFilterChange: (next: Partial<WorkspaceFilters>) => void;
  accounts: Account[];
  team: TeamMember[];
  projectCount: number;
  onClearFilters: () => void;
}

export function WorkspaceHeader({
  filters,
  onFilterChange,
  accounts,
  team,
  projectCount,
  onClearFilters,
}: WorkspaceHeaderProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const onFilterChangeRef = useRef(onFilterChange);
  useEffect(() => { onFilterChangeRef.current = onFilterChange; });

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as Element;
      const inInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.getAttribute("role") === "combobox";

      if (e.key === "Escape") {
        const el = searchRef.current;
        if (el && document.activeElement === el) {
          if (el.value) {
            onFilterChangeRef.current({ q: "" });
          } else {
            el.blur();
          }
          e.preventDefault();
        }
        return;
      }

      if (e.key === "/") {
        if (!inInput) {
          e.preventDefault();
          searchRef.current?.focus();
        }
        return;
      }

      if (inInput || e.ctrlKey || e.metaKey || e.altKey) return;

      switch (e.key) {
        case "b": onFilterChangeRef.current({ view: "board" }); break;
        case "t": onFilterChangeRef.current({ view: "table" }); break;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const accountOptions: FilterOption[] = [
    { value: ALL_SENTINEL, label: "All accounts" },
    ...accounts.map((a) => ({ value: a.id, label: a.name })),
  ];

  const ownerOptions: FilterOption[] = [
    { value: ALL_SENTINEL, label: "All owners" },
    ...team.map((m) => ({ value: m.user_id, label: m.name || m.email.split("@")[0] })),
  ];

  const availableChips = filters.showCancelled
    ? [...STATUS_CHIPS, CANCELLED_CHIP]
    : STATUS_CHIPS;

  const statusOptions: FilterOption[] = availableChips.map((chip) => ({
    value: chip.value,
    label: chip.label,
  }));

  const activeFiltersCount = [
    !!filters.q,
    filters.account !== ALL_SENTINEL,
    filters.owner !== ALL_SENTINEL,
    filters.statuses.length > 0,
  ].filter(Boolean).length;

  const filterDefs: FilterDef[] = [
    {
      id: "account",
      label: "Account",
      multiple: false,
      defaultValue: ALL_SENTINEL,
      value: filters.account,
      onChange: (v: string) => onFilterChange({ account: v }),
      options: accountOptions,
    },
    {
      id: "owner",
      label: "Owner",
      multiple: false,
      defaultValue: ALL_SENTINEL,
      value: filters.owner,
      onChange: (v: string) => onFilterChange({ owner: v }),
      options: ownerOptions,
    },
    {
      id: "status",
      label: "Status",
      multiple: true,
      searchable: false,
      value: filters.statuses,
      onChange: (next: string[]) => onFilterChange({ statuses: next as ProjectStatus[] }),
      options: statusOptions,
    },
  ];

  return (
    <div className="flex flex-col gap-1">
      {/* Title row */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Projects</h1>
        <Tabs
          value={filters.view}
          onValueChange={(v) => onFilterChange({ view: v as WorkspaceFilters["view"] })}
        >
          <TabsList>
            <TabsTrigger value="board" className="gap-1.5 text-xs">
              <LayoutGrid className="h-3.5 w-3.5" />
              Board
            </TabsTrigger>
            <TabsTrigger value="table" className="gap-1.5 text-xs">
              <TableProperties className="h-3.5 w-3.5" />
              Table
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Toolbar card */}
      <div className="shrink-0">
        {/* Top row: count + search + spacer + Filters */}
        <div className="flex flex-wrap items-center gap-3 p-3">
          <div className="text-sm font-medium text-muted-foreground shrink-0">
            {projectCount} {projectCount === 1 ? "Project" : "Projects"}
          </div>
          <div className="relative w-60">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              ref={searchRef}
              type="text"
              value={filters.q}
              onChange={(e) => onFilterChange({ q: e.target.value })}
              placeholder="Search projects…"
              aria-label="Search"
              className="w-full h-9 pl-9 pr-3 rounded-md border border-input bg-background text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex-1" />
          <FilterMenu filters={filterDefs} activeCount={activeFiltersCount} onClearAll={onClearFilters} />
        </div>

        {/* Show cancelled toggle */}
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
          <Checkbox
            id="show-cancelled"
            checked={filters.showCancelled}
            onCheckedChange={(checked) => {
              const next: Partial<WorkspaceFilters> = { showCancelled: Boolean(checked) };
              if (!checked && filters.statuses.includes("cancelled")) {
                next.statuses = filters.statuses.filter((s) => s !== "cancelled");
              }
              onFilterChange(next);
            }}
          />
          <Label htmlFor="show-cancelled" className="text-xs text-gray-500 cursor-pointer">
            Show cancelled
          </Label>
        </div>

        {activeFiltersCount > 0 && <FilterChips filters={filterDefs} onClearAll={onClearFilters} />}
      </div>
    </div>
  );
}

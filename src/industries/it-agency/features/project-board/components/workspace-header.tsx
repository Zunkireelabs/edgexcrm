"use client";

import { Search, LayoutGrid, TableProperties } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FilterDropdown, type FilterOption } from "@/components/ui/filter-dropdown";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { Account, ProjectStatus } from "@/types/database";
import type { TeamMember } from "../hooks/use-projects";
import type { WorkspaceFilters } from "../hooks/use-workspace-filters";

const ALL_SENTINEL = "__all__";

const STATUS_CHIPS: { value: ProjectStatus; label: string }[] = [
  { value: "planning",  label: "Discovery" },
  { value: "active",    label: "In Progress" },
  { value: "in_review", label: "Review" },
  { value: "delivered", label: "Delivered" },
  { value: "on_hold",   label: "On Hold" },
];

const CANCELLED_CHIP: { value: ProjectStatus; label: string } = {
  value: "cancelled",
  label: "Cancelled",
};

interface WorkspaceHeaderProps {
  filters: WorkspaceFilters;
  onFilterChange: (next: Partial<WorkspaceFilters>) => void;
  accounts: Account[];
  team: TeamMember[];
}

export function WorkspaceHeader({
  filters,
  onFilterChange,
  accounts,
  team,
}: WorkspaceHeaderProps) {
  const accountOptions: FilterOption[] = [
    { value: ALL_SENTINEL, label: "All accounts" },
    ...accounts.map((a) => ({ value: a.id, label: a.name })),
  ];

  const ownerOptions: FilterOption[] = [
    { value: ALL_SENTINEL, label: "All owners" },
    ...team.map((m) => ({ value: m.user_id, label: m.email })),
  ];

  // The chip set: base statuses + cancelled when show-cancelled toggle is on
  const availableChips = filters.showCancelled
    ? [...STATUS_CHIPS, CANCELLED_CHIP]
    : STATUS_CHIPS;

  function toggleStatus(value: ProjectStatus) {
    const current = filters.statuses;
    const next = current.includes(value)
      ? current.filter((s) => s !== value)
      : [...current, value];
    onFilterChange({ statuses: next });
  }

  function isStatusActive(value: ProjectStatus): boolean {
    // Empty = all selected (no filter applied)
    return filters.statuses.length === 0 || filters.statuses.includes(value);
  }

  return (
    <div className="flex flex-col gap-3 pb-3 border-b border-gray-200">
      {/* Row 1: title + view tabs */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LayoutGrid className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Projects</h1>
        </div>
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

      {/* Row 2: search + dropdowns + show-cancelled */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={filters.q}
            onChange={(e) => onFilterChange({ q: e.target.value })}
            placeholder="Search projects…"
            className="h-7 pl-8 pr-3 text-xs border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 w-44"
          />
        </div>

        {/* Account filter */}
        <FilterDropdown
          label="Account"
          value={filters.account}
          onChange={(v) => onFilterChange({ account: v })}
          options={accountOptions}
        />

        {/* Owner filter */}
        <FilterDropdown
          label="Owner"
          value={filters.owner}
          onChange={(v) => onFilterChange({ owner: v })}
          options={ownerOptions}
        />

        {/* Show cancelled toggle */}
        <div className="flex items-center gap-1.5 ml-1">
          <Checkbox
            id="show-cancelled"
            checked={filters.showCancelled}
            onCheckedChange={(checked) => {
              const next: Partial<WorkspaceFilters> = { showCancelled: Boolean(checked) };
              // Remove cancelled from statuses when hiding cancelled
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
      </div>

      {/* Row 3: status chips */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs text-muted-foreground mr-1">Status:</span>
        {availableChips.map((chip) => {
          const active = isStatusActive(chip.value);
          return (
            <button
              key={chip.value}
              type="button"
              onClick={() => toggleStatus(chip.value)}
              className={[
                "px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors",
                active
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-500 border-gray-300 hover:border-gray-400",
              ].join(" ")}
            >
              {chip.label}
            </button>
          );
        })}
        {filters.statuses.length > 0 && (
          <button
            type="button"
            onClick={() => onFilterChange({ statuses: [] })}
            className="px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground underline"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

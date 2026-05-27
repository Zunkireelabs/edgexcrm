"use client";

import { Search, LayoutGrid, TableProperties } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FilterDropdown, type FilterOption } from "@/components/ui/filter-dropdown";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { Account } from "@/types/database";
import type { TeamMember } from "../hooks/use-projects";
import type { WorkspaceFilters } from "../hooks/use-workspace-filters";

const ALL_SENTINEL = "__all__";

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

      {/* Row 2: filters */}
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
        <div className="flex items-center gap-1.5 ml-2">
          <Checkbox
            id="show-cancelled"
            checked={filters.showCancelled}
            onCheckedChange={(checked) => onFilterChange({ showCancelled: Boolean(checked) })}
          />
          <Label htmlFor="show-cancelled" className="text-xs text-gray-500 cursor-pointer">
            Show cancelled
          </Label>
        </div>
      </div>
    </div>
  );
}

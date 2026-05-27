"use client";

import { useRef, useEffect } from "react";
import { Search, LayoutGrid, TableProperties, ListTodo, Users } from "lucide-react";
import { TagMultiPicker } from "./tag-multi-picker";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FilterDropdown, type FilterOption } from "@/components/ui/filter-dropdown";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { Account, ProjectStatus, TaskStatus, TaskPriority } from "@/types/database";
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

const TASK_STATUS_CHIPS: { value: TaskStatus; label: string }[] = [
  { value: "todo",        label: "To Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "done",        label: "Done" },
];

const PRIORITY_CHIPS: { value: TaskPriority; label: string; cls: string }[] = [
  { value: "low",    label: "Low",    cls: "bg-gray-100 text-gray-600 border-gray-200" },
  { value: "normal", label: "Normal", cls: "bg-blue-50 text-blue-600 border-blue-200" },
  { value: "high",   label: "High",   cls: "bg-amber-50 text-amber-700 border-amber-200" },
  { value: "urgent", label: "Urgent", cls: "bg-red-50 text-red-600 border-red-200" },
];

const DUE_OPTIONS: FilterOption[] = [
  { value: ALL_SENTINEL, label: "All due dates" },
  { value: "overdue",    label: "Overdue" },
  { value: "today",      label: "Today" },
  { value: "this_week",  label: "This week" },
  { value: "none",       label: "No due date" },
];

interface WorkspaceHeaderProps {
  filters: WorkspaceFilters;
  onFilterChange: (next: Partial<WorkspaceFilters>) => void;
  accounts: Account[];
  team: TeamMember[];
  poolTags: string[];
}

export function WorkspaceHeader({
  filters,
  onFilterChange,
  accounts,
  team,
  poolTags,
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
        case "k": onFilterChangeRef.current({ view: "tasks" }); break;
        case "m": onFilterChangeRef.current({ view: "members" }); break;
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
    ...team.map((m) => ({ value: m.user_id, label: m.email })),
  ];

  const assigneeOptions: FilterOption[] = [
    { value: ALL_SENTINEL, label: "All assignees" },
    ...team.map((m) => ({ value: m.user_id, label: m.email })),
  ];

  const availableChips = filters.showCancelled
    ? [...STATUS_CHIPS, CANCELLED_CHIP]
    : STATUS_CHIPS;

  function toggleProjectStatus(value: ProjectStatus) {
    const current = filters.statuses;
    const next = current.includes(value)
      ? current.filter((s) => s !== value)
      : [...current, value];
    onFilterChange({ statuses: next });
  }

  function isProjectStatusActive(value: ProjectStatus): boolean {
    return filters.statuses.length === 0 || filters.statuses.includes(value);
  }

  function toggleTaskStatus(value: TaskStatus) {
    const current = filters.taskStatuses;
    const next = current.includes(value)
      ? current.filter((s) => s !== value)
      : [...current, value];
    onFilterChange({ taskStatuses: next });
  }

  function isTaskStatusActive(value: TaskStatus): boolean {
    return filters.taskStatuses.length === 0 || filters.taskStatuses.includes(value);
  }

  function togglePriority(value: TaskPriority) {
    const current = filters.priorities;
    const next = current.includes(value)
      ? current.filter((p) => p !== value)
      : [...current, value];
    onFilterChange({ priorities: next });
  }

  function isPriorityActive(value: TaskPriority): boolean {
    return filters.priorities.length === 0 || filters.priorities.includes(value);
  }

  const isTasksView = filters.view === "tasks";
  const isBoardOrTable = filters.view === "board" || filters.view === "table";
  const isMembersView = filters.view === "members";

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
            <TabsTrigger value="tasks" className="gap-1.5 text-xs">
              <ListTodo className="h-3.5 w-3.5" />
              Tasks
            </TabsTrigger>
            <TabsTrigger value="members" className="gap-1.5 text-xs">
              <Users className="h-3.5 w-3.5" />
              Members
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Row 2: search + shared dropdowns + view-specific dropdowns */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
          <input
            ref={searchRef}
            type="text"
            value={filters.q}
            onChange={(e) => onFilterChange({ q: e.target.value })}
            placeholder={isTasksView ? "Search tasks…" : isMembersView ? "Search projects & tasks…" : "Search projects…"}
            aria-label="Search"
            className="h-7 pl-8 pr-3 text-xs border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 w-44"
          />
        </div>

        {/* Account filter — all views */}
        <FilterDropdown
          label="Account"
          value={filters.account}
          onChange={(v) => onFilterChange({ account: v })}
          options={accountOptions}
        />

        {/* Owner filter — Board, Table, Members */}
        {(isBoardOrTable || isMembersView) && (
          <FilterDropdown
            label="Owner"
            value={filters.owner}
            onChange={(v) => onFilterChange({ owner: v })}
            options={ownerOptions}
          />
        )}

        {/* Assignee filter — Tasks + Members */}
        {(isTasksView || isMembersView) && (
          <FilterDropdown
            label="Assignee"
            value={filters.assignee}
            onChange={(v) => onFilterChange({ assignee: v })}
            options={assigneeOptions}
          />
        )}

        {/* Due keyword — Tasks + Members */}
        {(isTasksView || isMembersView) && (
          <FilterDropdown
            label="Due"
            value={filters.due}
            onChange={(v) => onFilterChange({ due: v })}
            options={DUE_OPTIONS}
            searchable={false}
          />
        )}

        {/* Show cancelled toggle — Board + Table only */}
        {isBoardOrTable && (
          <div className="flex items-center gap-1.5 ml-1">
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
        )}
      </div>

      {/* Row 3: project status chips (Board + Table) */}
      {isBoardOrTable && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-muted-foreground mr-1">Status:</span>
          {availableChips.map((chip) => {
            const active = isProjectStatusActive(chip.value);
            return (
              <button
                key={chip.value}
                type="button"
                aria-pressed={active}
                onClick={() => toggleProjectStatus(chip.value)}
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
      )}

      {/* Task status chips — Tasks view only */}
      {isTasksView && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-muted-foreground mr-1">Status:</span>
          {TASK_STATUS_CHIPS.map((chip) => {
            const active = isTaskStatusActive(chip.value);
            return (
              <button
                key={chip.value}
                type="button"
                aria-pressed={active}
                onClick={() => toggleTaskStatus(chip.value)}
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
          {filters.taskStatuses.length > 0 && (
            <button
              type="button"
              onClick={() => onFilterChange({ taskStatuses: [] })}
              className="px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground underline"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Priority chips — Tasks + Members views */}
      {(isTasksView || isMembersView) && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-muted-foreground mr-1">Priority:</span>
          {PRIORITY_CHIPS.map((chip) => {
            const active = isPriorityActive(chip.value);
            return (
              <button
                key={chip.value}
                type="button"
                aria-pressed={active}
                onClick={() => togglePriority(chip.value)}
                className={[
                  "px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors",
                  active
                    ? `${chip.cls}`
                    : "bg-white text-gray-400 border-gray-200 hover:border-gray-300",
                  filters.priorities.length > 0 && !filters.priorities.includes(chip.value)
                    ? "opacity-40"
                    : "",
                ].join(" ")}
              >
                {chip.label}
              </button>
            );
          })}
          {filters.priorities.length > 0 && (
            <button
              type="button"
              onClick={() => onFilterChange({ priorities: [] })}
              className="px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground underline"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Tags filter — Tasks view only */}
      {isTasksView && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-muted-foreground mr-1">Tags:</span>
          <TagMultiPicker
            value={filters.tags}
            onChange={(next) => onFilterChange({ tags: next })}
            allTags={poolTags}
            placeholder="Filter by tag…"
            size="md"
          />
        </div>
      )}
    </div>
  );
}

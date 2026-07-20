"use client";

import { useRef, useEffect } from "react";
import { Search, ListTodo, Users } from "lucide-react";
import { TagMultiPicker } from "./tag-multi-picker";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type FilterOption } from "@/components/ui/filter-dropdown";
import { FilterMenu, FilterChips, type FilterDef } from "@/components/ui/filter-menu";
import type { Account, TaskStatus, TaskPriority } from "@/types/database";
import type { TeamMember } from "../hooks/use-projects";
import type { WorkspaceFilters } from "../hooks/use-workspace-filters";
import { ALL_SENTINEL, TASK_STATUS_CHIPS, PRIORITY_CHIPS, DUE_OPTIONS } from "../lib/filter-options";

interface TasksWorkspaceHeaderProps {
  filters: WorkspaceFilters;
  onFilterChange: (next: Partial<WorkspaceFilters>) => void;
  accounts: Account[];
  team: TeamMember[];
  poolTags: string[];
  onClearFilters: () => void;
}

export function TasksWorkspaceHeader({
  filters,
  onFilterChange,
  accounts,
  team,
  poolTags,
  onClearFilters,
}: TasksWorkspaceHeaderProps) {
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
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const isListView = filters.view === "tasks";

  const accountOptions: FilterOption[] = [
    { value: ALL_SENTINEL, label: "All accounts" },
    ...accounts.map((a) => ({ value: a.id, label: a.name })),
  ];

  const assigneeOptions: FilterOption[] = [
    { value: ALL_SENTINEL, label: "All assignees" },
    ...team.map((m) => ({ value: m.user_id, label: m.name || m.email.split("@")[0] })),
  ];

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

  const activeFiltersCount = [
    !!filters.q,
    filters.account !== ALL_SENTINEL,
    filters.assignee !== ALL_SENTINEL,
    filters.due !== ALL_SENTINEL,
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
      id: "assignee",
      label: "Assignee",
      multiple: false,
      defaultValue: ALL_SENTINEL,
      value: filters.assignee,
      onChange: (v: string) => onFilterChange({ assignee: v }),
      options: assigneeOptions,
    },
    {
      id: "due",
      label: "Due",
      multiple: false,
      searchable: false,
      defaultValue: ALL_SENTINEL,
      value: filters.due,
      onChange: (v: string) => onFilterChange({ due: v }),
      options: DUE_OPTIONS,
    },
  ];

  return (
    <div className="flex flex-col gap-1">
      {/* Title row */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Tasks</h1>
        <Tabs
          value={filters.view}
          onValueChange={(v) => onFilterChange({ view: v as WorkspaceFilters["view"] })}
        >
          <TabsList>
            <TabsTrigger value="tasks" className="gap-1.5 text-xs">
              <ListTodo className="h-3.5 w-3.5" />
              List
            </TabsTrigger>
            <TabsTrigger value="members" className="gap-1.5 text-xs">
              <Users className="h-3.5 w-3.5" />
              By member
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Toolbar card */}
      <div className="shrink-0">
        <div className="flex flex-wrap items-center gap-3 p-3">
          <div className="relative w-60">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              ref={searchRef}
              type="text"
              value={filters.q}
              onChange={(e) => onFilterChange({ q: e.target.value })}
              placeholder={isListView ? "Search tasks…" : "Search projects & tasks…"}
              aria-label="Search"
              className="w-full h-9 pl-9 pr-3 rounded-md border border-input bg-background text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex-1" />
          <FilterMenu filters={filterDefs} activeCount={activeFiltersCount} onClearAll={onClearFilters} />
        </div>

        {activeFiltersCount > 0 && <FilterChips filters={filterDefs} onClearAll={onClearFilters} />}
      </div>

      {/* Task status chips — List view only */}
      {isListView && (
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

      {/* Priority chips — both views */}
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

      {/* Tags filter — List view only */}
      {isListView && (
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

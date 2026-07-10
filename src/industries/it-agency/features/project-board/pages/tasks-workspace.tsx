"use client";

import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { useProjects } from "../hooks/use-projects";
import { useWorkspaceFilters } from "../hooks/use-workspace-filters";
import { useTaskTags } from "../hooks/use-task-tags";
import { TasksWorkspaceHeader } from "../components/tasks-workspace-header";
import { TasksView } from "../components/views/tasks-view";
import { MembersView } from "../components/views/members-view";
import { ActiveTimersProvider } from "@/industries/it-agency/features/time-tracking/hooks/use-active-timers";

function TasksWorkspaceInner() {
  const { projects, accounts, team, accountMap, teamMap, loading } = useProjects();
  const { filters, setFilters } = useWorkspaceFilters("tasks");
  const { tags: poolTags, refetchTags } = useTaskTags();

  function handleClearFilters() {
    setFilters({
      account: "__all__",
      q: "",
      assignee: "__all__",
      taskStatuses: [],
      priorities: [],
      tags: [],
      due: "__all__",
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 h-full">
      <TasksWorkspaceHeader
        filters={filters}
        onFilterChange={setFilters}
        accounts={accounts}
        team={team}
        poolTags={poolTags}
        onClearFilters={handleClearFilters}
      />

      {filters.view === "members" ? (
        <MembersView
          filters={filters}
          team={team}
          projects={projects}
          accountMap={accountMap}
          onClearFilters={handleClearFilters}
        />
      ) : (
        <ActiveTimersProvider>
          <TasksView
            filters={filters}
            team={team}
            teamMap={teamMap}
            poolTags={poolTags}
            refetchTags={refetchTags}
            onClearFilters={handleClearFilters}
          />
        </ActiveTimersProvider>
      )}
    </div>
  );
}

export function TasksWorkspacePage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <TasksWorkspaceInner />
    </Suspense>
  );
}

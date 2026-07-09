"use client";

import { useMemo, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { useProjects, type ProjectWithMetrics } from "../hooks/use-projects";
import { useWorkspaceFilters } from "../hooks/use-workspace-filters";
import { useTaskTags } from "../hooks/use-task-tags";
import { WorkspaceHeader } from "../components/workspace-header";
import { BoardView } from "../components/views/board-view";
import { TableView } from "../components/views/table-view";
import { TasksView } from "../components/views/tasks-view";
import { MembersView } from "../components/views/members-view";
import type { ProjectWithAccount } from "../components/project-card";
import type { ProjectStatus } from "@/types/database";

interface ProjectWorkspacePageProps {
  tenantId: string;
  role: string;
}

function WorkspaceInner({ tenantId: _tenantId, role: _role }: ProjectWorkspacePageProps) {
  const { projects, accounts, team, accountMap, teamMap, hoursMap, loading, refetch, setProjects } =
    useProjects();
  const { filters, setFilters } = useWorkspaceFilters();
  const { tags: poolTags, refetchTags } = useTaskTags();

  const filtered: ProjectWithAccount[] = useMemo(() => {
    const q = filters.q.toLowerCase();
    return projects
      .map((p) => ({
        ...p,
        account_name: accountMap.get(p.account_id)?.name ?? "Unknown account",
      }))
      .filter((p) => {
        if (!filters.showCancelled && p.status === "cancelled") return false;
        if (filters.statuses.length > 0 && !filters.statuses.includes(p.status as ProjectStatus))
          return false;
        if (filters.account !== "__all__" && p.account_id !== filters.account) return false;
        if (filters.owner !== "__all__" && p.owner_id !== filters.owner) return false;
        if (q && !p.name.toLowerCase().includes(q)) return false;
        return true;
      });
  }, [projects, accountMap, filters]);

  function handleProjectUpdated(updated: ProjectWithAccount) {
    const { account_name, ...projectData } = updated;
    void account_name;
    setProjects((prev: ProjectWithMetrics[]) =>
      prev.map((p) => (p.id === updated.id ? { ...p, ...projectData } : p))
    );
  }

  function handleClearFilters() {
    setFilters({
      account: "__all__",
      q: "",
      owner: "__all__",
      showCancelled: false,
      statuses: [],
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
      <WorkspaceHeader
        filters={filters}
        onFilterChange={setFilters}
        accounts={accounts}
        team={team}
        poolTags={poolTags}
        projectCount={filtered.length}
        onClearFilters={handleClearFilters}
      />

      {filters.view === "board" ? (
        <BoardView
          projects={filtered}
          filters={filters}
          teamMap={teamMap}
          hoursMap={hoursMap}
          onProjectUpdated={handleProjectUpdated}
          onRefetch={refetch}
          onClearFilters={handleClearFilters}
        />
      ) : filters.view === "table" ? (
        <TableView
          projects={filtered}
          team={team}
          teamMap={teamMap}
          onProjectUpdated={handleProjectUpdated}
          onClearFilters={handleClearFilters}
        />
      ) : filters.view === "tasks" ? (
        <TasksView
          filters={filters}
          team={team}
          teamMap={teamMap}
          poolTags={poolTags}
          refetchTags={refetchTags}
          onClearFilters={handleClearFilters}
        />
      ) : (
        <MembersView
          filters={filters}
          team={team}
          projects={projects}
          accountMap={accountMap}
          onClearFilters={handleClearFilters}
        />
      )}
    </div>
  );
}

export function ProjectWorkspacePage(props: ProjectWorkspacePageProps) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <WorkspaceInner {...props} />
    </Suspense>
  );
}

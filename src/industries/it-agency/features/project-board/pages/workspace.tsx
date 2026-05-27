"use client";

import { useMemo, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { useProjects } from "../hooks/use-projects";
import { useWorkspaceFilters } from "../hooks/use-workspace-filters";
import { WorkspaceHeader } from "../components/workspace-header";
import { BoardView } from "../components/views/board-view";
import { TableView } from "../components/views/table-view";
import type { ProjectWithAccount } from "../components/project-card";

interface ProjectWorkspacePageProps {
  tenantId: string;
  role: string;
}

function WorkspaceInner({ tenantId: _tenantId, role: _role }: ProjectWorkspacePageProps) {
  const { projects, accounts, team, accountMap, teamMap, loading, setProjects } = useProjects();
  const { filters, setFilters } = useWorkspaceFilters();

  const filtered: ProjectWithAccount[] = useMemo(() => {
    const q = filters.q.toLowerCase();
    return projects
      .map((p) => ({
        ...p,
        account_name: accountMap.get(p.account_id)?.name ?? "Unknown account",
      }))
      .filter((p) => {
        if (filters.account !== "__all__" && p.account_id !== filters.account) return false;
        if (filters.owner !== "__all__" && p.owner_id !== filters.owner) return false;
        if (!filters.showCancelled && p.status === "cancelled") return false;
        if (q && !p.name.toLowerCase().includes(q)) return false;
        return true;
      });
  }, [projects, accountMap, filters]);

  function handleProjectUpdated(updated: ProjectWithAccount) {
    setProjects((prev) =>
      prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p))
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-6 h-full">
      <WorkspaceHeader
        filters={filters}
        onFilterChange={setFilters}
        accounts={accounts}
        team={team}
      />

      {filters.view === "board" ? (
        <BoardView projects={filtered} filters={filters} teamMap={teamMap} />
      ) : (
        <TableView
          projects={filtered}
          team={team}
          teamMap={teamMap}
          onProjectUpdated={handleProjectUpdated}
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

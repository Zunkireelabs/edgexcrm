"use client";

import { useMemo, useState, Suspense } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useProjects, type ProjectWithMetrics } from "../hooks/use-projects";
import { useWorkspaceFilters } from "../hooks/use-workspace-filters";
import { WorkspaceHeader } from "../components/workspace-header";
import { ProjectForm } from "../components/project-form";
import { BoardView } from "../components/views/board-view";
import { TableView } from "../components/views/table-view";
import type { ProjectWithAccount } from "../components/project-card";
import type { Project, ProjectStatus } from "@/types/database";

interface ProjectWorkspacePageProps {
  tenantId: string;
  role: string;
}

function WorkspaceInner({ tenantId: _tenantId, role }: ProjectWorkspacePageProps) {
  const router = useRouter();
  const canCreate = role === "owner" || role === "admin";
  const [createOpen, setCreateOpen] = useState(false);
  const { projects, accounts, team, accountMap, teamMap, hoursMap, loading, refetch, setProjects } =
    useProjects();
  const { filters, setFilters } = useWorkspaceFilters();

  const filtered: ProjectWithAccount[] = useMemo(() => {
    const q = filters.q.toLowerCase();
    return projects
      .map((p) => ({
        ...p,
        account_name: p.account_id
          ? accountMap.get(p.account_id)?.name ?? "Unknown account"
          : "Internal",
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
        projectCount={filtered.length}
        onClearFilters={handleClearFilters}
        canCreate={canCreate}
        onNewProject={() => setCreateOpen(true)}
      />

      <ProjectForm
        accounts={accounts}
        team={team}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={(project: Project) => {
          setProjects((prev) => [{ ...project, contact_count: 0 } as ProjectWithMetrics, ...prev]);
          router.push(`/projects/${project.id}`);
        }}
      />

      {filters.view === "table" ? (
        <TableView
          projects={filtered}
          team={team}
          teamMap={teamMap}
          onProjectUpdated={handleProjectUpdated}
          onClearFilters={handleClearFilters}
          hasAnyProjects={projects.length > 0}
          canCreate={canCreate}
          onNewProject={() => setCreateOpen(true)}
        />
      ) : (
        <BoardView
          projects={filtered}
          filters={filters}
          teamMap={teamMap}
          hoursMap={hoursMap}
          onProjectUpdated={handleProjectUpdated}
          onRefetch={refetch}
          onClearFilters={handleClearFilters}
          hasAnyProjects={projects.length > 0}
          canCreate={canCreate}
          onNewProject={() => setCreateOpen(true)}
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

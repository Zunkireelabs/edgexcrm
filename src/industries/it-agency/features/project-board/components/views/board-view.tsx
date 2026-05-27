"use client";

import { useMemo } from "react";
import type { ProjectStatus } from "@/types/database";
import { ProjectColumn, COLUMN_ORDER } from "../project-column";
import type { ProjectWithAccount } from "../project-card";
import type { TeamMember } from "../../hooks/use-projects";
import type { WorkspaceFilters } from "../../hooks/use-workspace-filters";

interface BoardViewProps {
  projects: ProjectWithAccount[];
  filters: WorkspaceFilters;
  teamMap: Map<string, TeamMember>;
}

export function BoardView({ projects, filters, teamMap }: BoardViewProps) {
  const visibleColumns: ProjectStatus[] = filters.showCancelled
    ? [...COLUMN_ORDER, "cancelled"]
    : COLUMN_ORDER;

  const byStatus = useMemo(() => {
    const map = new Map<ProjectStatus, ProjectWithAccount[]>();
    for (const status of visibleColumns) map.set(status, []);
    for (const p of projects) {
      if (map.has(p.status as ProjectStatus)) {
        map.get(p.status as ProjectStatus)!.push(p);
      }
    }
    for (const col of map.values()) {
      col.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    }
    return map;
  }, [projects, visibleColumns]);

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {visibleColumns.map((status) => (
        <ProjectColumn
          key={status}
          status={status}
          projects={byStatus.get(status) ?? []}
          teamMap={teamMap}
        />
      ))}
    </div>
  );
}

"use client";

import { useState, useMemo, useRef } from "react";
import {
  DndContext,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { Building2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { ProjectStatus } from "@/types/database";
import { ProjectColumn, COLUMN_ORDER } from "../project-column";
import { ProjectCard, type ProjectWithAccount } from "../project-card";
import type { TeamMember } from "../../hooks/use-projects";
import type { WorkspaceFilters } from "../../hooks/use-workspace-filters";

type ColumnMap = Map<ProjectStatus, ProjectWithAccount[]>;

function buildColumnMap(
  projects: ProjectWithAccount[],
  visibleColumns: ProjectStatus[]
): ColumnMap {
  const map: ColumnMap = new Map();
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
}

interface BoardViewProps {
  projects: ProjectWithAccount[];
  filters: WorkspaceFilters;
  teamMap: Map<string, TeamMember>;
  hoursMap: Map<string, number>;
  onProjectUpdated: (updated: ProjectWithAccount) => void;
  onRefetch: () => void;
}

export function BoardView({
  projects,
  filters,
  teamMap,
  hoursMap,
  onProjectUpdated,
  onRefetch,
}: BoardViewProps) {
  const visibleColumns: ProjectStatus[] = useMemo(() => {
    const base: ProjectStatus[] = filters.showCancelled
      ? [...COLUMN_ORDER, "cancelled"]
      : [...COLUMN_ORDER];
    if (filters.statuses.length === 0) return base;
    return base.filter((s) => filters.statuses.includes(s));
  }, [filters.showCancelled, filters.statuses]);

  // optimisticByStatus is non-null only during an in-flight PATCH
  const [optimisticByStatus, setOptimisticByStatus] = useState<ColumnMap | null>(null);
  const [draggingProject, setDraggingProject] = useState<ProjectWithAccount | null>(null);

  const byStatus: ColumnMap = useMemo(() => {
    if (optimisticByStatus !== null) return optimisticByStatus;
    return buildColumnMap(projects, visibleColumns);
  }, [optimisticByStatus, projects, visibleColumns]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Ref to hold the original project during the async drag-end cycle
  const originalProjectRef = useRef<ProjectWithAccount | null>(null);

  function handleDragStart(event: DragStartEvent) {
    const id = event.active.id as string;
    const project = Array.from(byStatus.values())
      .flat()
      .find((p) => p.id === id) ?? null;
    setDraggingProject(project);
    originalProjectRef.current = project;
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setDraggingProject(null);

    const originalProject = originalProjectRef.current;
    originalProjectRef.current = null;

    if (!over || !originalProject) return;

    const projectId = active.id as string;
    const targetStatus = over.id as ProjectStatus;

    if (originalProject.status === targetStatus) return;

    // Optimistic: rebuild column map with the project at its new status
    const optimisticProjects = projects.map((p) =>
      p.id === projectId ? { ...p, status: targetStatus } : p
    );
    setOptimisticByStatus(buildColumnMap(optimisticProjects, visibleColumns));

    try {
      const res = await fetch(`/api/v1/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: targetStatus,
          expected_status: originalProject.status,
        }),
      });

      if (res.status === 409) {
        const json = await res.json().catch(() => ({}));
        setOptimisticByStatus(null);
        toast.error(json?.error?.message ?? "Project was moved by another user — refreshing.");
        onRefetch();
        return;
      }

      if (!res.ok) {
        setOptimisticByStatus(null);
        toast.error("Failed to move project. Please try again.");
        return;
      }

      const json = await res.json();
      const updatedProject: ProjectWithAccount = {
        ...originalProject,
        ...(json.data ?? {}),
        account_name: originalProject.account_name,
        contact_count: originalProject.contact_count,
      };
      onProjectUpdated(updatedProject);
      // Clear optimistic state — projects prop will update via onProjectUpdated
      setOptimisticByStatus(null);
    } catch {
      setOptimisticByStatus(null);
      toast.error("Failed to move project. Please try again.");
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4">
        {visibleColumns.map((status) => (
          <ProjectColumn
            key={status}
            status={status}
            projects={byStatus.get(status) ?? []}
            teamMap={teamMap}
            hoursMap={hoursMap}
          />
        ))}
      </div>

      <DragOverlay>
        {draggingProject ? (
          <div className="opacity-90 cursor-grabbing w-[220px]">
            <Card className="shadow-xl">
              <CardContent className="p-3 space-y-1">
                <p className="text-sm font-medium leading-tight line-clamp-2">
                  {draggingProject.name}
                </p>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Building2 className="h-3 w-3 shrink-0" />
                  <span className="truncate">{draggingProject.account_name}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

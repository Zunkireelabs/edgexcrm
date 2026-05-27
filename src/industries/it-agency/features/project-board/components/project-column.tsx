"use client";

import { useDroppable } from "@dnd-kit/core";
import type { ProjectStatus } from "@/types/database";
import { ProjectCard, type ProjectWithAccount } from "./project-card";
import type { TeamMember } from "../hooks/use-projects";

interface ColumnConfig {
  label: string;
  muted?: boolean;
}

export const COLUMN_CONFIG: Record<ProjectStatus, ColumnConfig> = {
  planning:  { label: "Discovery" },
  active:    { label: "In Progress" },
  in_review: { label: "Review" },
  delivered: { label: "Delivered" },
  on_hold:   { label: "On Hold", muted: true },
  cancelled: { label: "Cancelled" },
};

export const COLUMN_ORDER: ProjectStatus[] = [
  "planning",
  "active",
  "in_review",
  "delivered",
  "on_hold",
];

interface ProjectColumnProps {
  status: ProjectStatus;
  projects: ProjectWithAccount[];
  teamMap: Map<string, TeamMember>;
  hoursMap: Map<string, number>;
}

export function ProjectColumn({ status, projects, teamMap, hoursMap }: ProjectColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const cfg = COLUMN_CONFIG[status];

  return (
    <div
      ref={setNodeRef}
      className={[
        "flex flex-col gap-2 min-w-[220px] w-[220px]",
        cfg.muted ? "opacity-60" : "",
        isOver ? "ring-2 ring-blue-300 ring-inset rounded-lg" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex items-center justify-between px-1">
        <span className="text-sm font-semibold text-foreground">{cfg.label}</span>
        <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
          {projects.length}
        </span>
      </div>
      <div className="flex flex-col gap-2 min-h-[80px]">
        {projects.length === 0 ? (
          <p className="text-xs text-muted-foreground/60 text-center py-4 px-2 border border-dashed rounded-lg">
            No projects
          </p>
        ) : (
          projects.map((p) => (
            <ProjectCard key={p.id} project={p} teamMap={teamMap} hoursMap={hoursMap} />
          ))
        )}
      </div>
    </div>
  );
}

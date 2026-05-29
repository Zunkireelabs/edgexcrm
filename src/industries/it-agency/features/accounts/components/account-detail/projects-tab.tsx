"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProjectStatusBadge, PROJECT_STATUS_MAP } from "@/industries/it-agency/features/time-tracking/components/status-badge";
import type { Project, ProjectStatus } from "@/types/database";

const STATUS_FILTERS: { value: ProjectStatus | "all" }[] = [
  { value: "all" },
  { value: "planning" },
  { value: "active" },
  { value: "in_review" },
  { value: "delivered" },
  { value: "on_hold" },
];

interface ProjectsTabProps {
  projects: Project[];
  isAdmin: boolean;
  onCreateProject: () => void;
}

export function ProjectsTab({ projects, isAdmin, onCreateProject }: ProjectsTabProps) {
  const [filter, setFilter] = useState<ProjectStatus | "all">("all");

  const filtered = filter === "all" ? projects : projects.filter((p) => p.status === filter);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 flex-wrap">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                filter === f.value
                  ? "bg-foreground text-background border-foreground"
                  : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
              }`}
            >
              {f.value === "all" ? "All" : PROJECT_STATUS_MAP[f.value].label}
            </button>
          ))}
        </div>
        {isAdmin && (
          <Button size="sm" onClick={onCreateProject} className="shrink-0">
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New project
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          {filter === "all" ? "No projects yet." : `No ${filter} projects.`}
          {isAdmin && filter === "all" && (
            <button
              type="button"
              className="ml-1 text-primary hover:underline"
              onClick={onCreateProject}
            >
              Create the first one.
            </button>
          )}
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((project) => (
            <Link
              key={project.id}
              href={`/time-tracking/projects/${project.id}`}
              className="flex items-center gap-3 p-3 border border-border rounded-lg hover:bg-muted/40 transition-colors group"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate" style={{ color: "#0f0f10" }}>{project.name}</p>
                <p className="text-xs mt-0.5" style={{ color: "#787871" }}>
                  {project.default_rate != null ? `$${project.default_rate}/hr · ` : ""}
                  {project.is_billable ? "Billable" : "Non-billable"}
                </p>
              </div>
              <ProjectStatusBadge status={project.status} />
              <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

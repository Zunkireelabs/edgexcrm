"use client";

import { LayoutGrid, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ProjectsEmptyStateProps {
  /** False only when the tenant has zero projects at all (not a filter miss). */
  hasAnyProjects: boolean;
  canCreate: boolean;
  onNewProject: () => void;
  onClearFilters: () => void;
}

export function ProjectsEmptyState({
  hasAnyProjects,
  canCreate,
  onNewProject,
  onClearFilters,
}: ProjectsEmptyStateProps) {
  if (hasAnyProjects) {
    // Zero after filtering — never show a create CTA here.
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
        <LayoutGrid className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">No projects match these filters.</p>
        <button
          type="button"
          onClick={onClearFilters}
          className="text-xs text-blue-600 hover:underline underline-offset-2"
        >
          Clear filters
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
      <LayoutGrid className="h-8 w-8 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground max-w-xs">
        No projects yet. Create your first project to start tracking delivery.
      </p>
      {canCreate ? (
        <Button size="sm" onClick={onNewProject}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          New project
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">Ask an admin to create one.</p>
      )}
    </div>
  );
}

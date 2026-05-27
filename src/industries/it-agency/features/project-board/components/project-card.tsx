"use client";

import Link from "next/link";
import { Building2, Users, Clock } from "lucide-react";
import { useDraggable } from "@dnd-kit/core";
import { Card, CardContent } from "@/components/ui/card";
import type { Project } from "@/types/database";
import type { TeamMember } from "../hooks/use-projects";

export interface ProjectWithAccount extends Project {
  account_name: string;
  contact_count: number;
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMo = Math.floor(diffDays / 30);
  return `${diffMo}mo ago`;
}

function ownerInitials(email: string): string {
  return email
    .split("@")[0]
    .split(/[._-]/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

interface ProjectCardProps {
  project: ProjectWithAccount;
  teamMap: Map<string, TeamMember>;
  hoursMap: Map<string, number>;
  /** True when rendered inside DragOverlay — disables drag listeners */
  isDragOverlay?: boolean;
}

export function ProjectCard({ project, teamMap, hoursMap, isDragOverlay = false }: ProjectCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: project.id,
    disabled: isDragOverlay,
  });

  const updatedAgo = relativeTime(project.updated_at);
  const owner = project.owner_id ? teamMap.get(project.owner_id) : null;
  const billableHrs = (hoursMap.get(project.id) ?? 0) / 60;
  const hasMetrics = project.contact_count > 0 || billableHrs > 0;

  return (
    <div
      ref={setNodeRef}
      {...(isDragOverlay ? {} : listeners)}
      {...(isDragOverlay ? {} : attributes)}
      className={isDragging ? "opacity-40" : ""}
    >
      <Link href={`/time-tracking/projects/${project.id}`} draggable={false}>
        <Card className="cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow">
          <CardContent className="p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium leading-tight line-clamp-2 flex-1">{project.name}</p>
              {owner && (
                <span
                  title={owner.email}
                  className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-[10px] font-semibold shrink-0"
                >
                  {ownerInitials(owner.email)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Building2 className="h-3 w-3 shrink-0" />
              <span className="truncate">{project.account_name}</span>
            </div>
            {hasMetrics && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground/70">
                {project.contact_count > 0 && (
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    {project.contact_count} contact{project.contact_count !== 1 ? "s" : ""}
                  </span>
                )}
                {billableHrs > 0 && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {billableHrs.toFixed(1)} billable hrs
                  </span>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground/70">Updated {updatedAgo}</p>
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Folder, MoreHorizontal, ExternalLink, Clock, User } from "lucide-react";
import { useDraggable } from "@dnd-kit/core";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { MemberAvatar } from "@/components/ui/member-avatar";
import { HealthDot } from "./health-dot";
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

function getDaysSinceUpdate(updatedAt: string): number {
  const diff = Date.now() - new Date(updatedAt).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function getUrgencyStyles(days: number): { bg: string; text: string } {
  if (days >= 7) return { bg: "bg-red-100", text: "text-red-700" };
  if (days >= 3) return { bg: "bg-amber-100", text: "text-amber-700" };
  return { bg: "bg-muted", text: "text-muted-foreground" };
}

interface ProjectCardProps {
  project: ProjectWithAccount;
  teamMap: Map<string, TeamMember>;
  hoursMap: Map<string, number>;
  /** True when rendered inside DragOverlay — disables drag listeners and click handler */
  isDragOverlay?: boolean;
}

export function ProjectCard({ project, teamMap, hoursMap, isDragOverlay = false }: ProjectCardProps) {
  const router = useRouter();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: project.id,
    disabled: isDragOverlay,
  });

  const owner = project.owner_id ? teamMap.get(project.owner_id) : null;
  const billableHrs = (hoursMap.get(project.id) ?? 0) / 60;
  const days = getDaysSinceUpdate(project.updated_at);
  const urgencyStyles = getUrgencyStyles(days);

  function handleCardClick() {
    router.push(`/projects/${project.id}`);
  }

  return (
    <div
      ref={setNodeRef}
      {...(isDragOverlay ? {} : listeners)}
      {...(isDragOverlay ? {} : attributes)}
      onClick={isDragOverlay ? undefined : handleCardClick}
      className={`group rounded-xl border bg-card p-4 transition-all cursor-pointer ${
        isDragging
          ? "opacity-50 ring-2 ring-primary/20 scale-[1.02]"
          : "hover:border-muted-foreground/30"
      }`}
    >
      {/* Section 1: Header — icon + name + dropdown */}
      <div className="flex items-start gap-3 mb-2">
        <div className="flex-shrink-0 h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <Folder className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <Link
            href={`/projects/${project.id}`}
            className="text-sm font-semibold hover:text-primary transition-colors line-clamp-1 block"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {project.name}
          </Link>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 -mr-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem asChild>
              <Link href={`/projects/${project.id}`}>
                <ExternalLink className="mr-2 h-3.5 w-3.5" />
                View Details
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Divider */}
      <div className="border-t border-border/50 my-3" />

      {/* Section 2: Metadata key:value grid */}
      <div className="space-y-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-16 flex-shrink-0">Account</span>
          <span className="text-foreground truncate">{project.account_name}</span>
        </div>
        {project.contact_count > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-16 flex-shrink-0">Contacts</span>
            <span className="text-foreground">{project.contact_count}</span>
          </div>
        )}
        {billableHrs > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-16 flex-shrink-0">Billable</span>
            <span className="text-foreground">{billableHrs.toFixed(1)} hrs</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-16 flex-shrink-0">Updated</span>
          <span className="text-foreground">{relativeTime(project.updated_at)}</span>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-border/50 my-3" />

      {/* Section 3: Footer — urgency badge + health + owner avatar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium ${urgencyStyles.bg} ${urgencyStyles.text}`}
          >
            <Clock className="h-3 w-3" />
            <span>{days === 0 ? "Today" : `${days}d`}</span>
          </div>
          <HealthDot project={project} />
        </div>
        {owner ? (
          <span title={owner.email} className="inline-flex">
            <MemberAvatar userId={owner.user_id} name={owner.name || owner.email.split("@")[0]} size={24} />
          </span>
        ) : (
          <div
            title="Unassigned"
            className="h-6 w-6 rounded-full bg-muted border border-border flex items-center justify-center"
          >
            <User className="h-3 w-3 text-muted-foreground" />
          </div>
        )}
      </div>
    </div>
  );
}

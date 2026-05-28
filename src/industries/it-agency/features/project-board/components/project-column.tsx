"use client";

import { useDroppable } from "@dnd-kit/core";
import { FolderOpen } from "lucide-react";
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

export const STATUS_COLOR: Record<ProjectStatus, string> = {
  planning:  "#3B82F6",
  active:    "#F59E0B",
  in_review: "#A855F7",
  delivered: "#10B981",
  on_hold:   "#9CA3AF",
  cancelled: "#EF4444",
};

interface ProjectColumnProps {
  status: ProjectStatus;
  projects: ProjectWithAccount[];
  teamMap: Map<string, TeamMember>;
  hoursMap: Map<string, number>;
}

export function ProjectColumn({ status, projects, teamMap, hoursMap }: ProjectColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const cfg = COLUMN_CONFIG[status];
  const totalBillableHrs = projects.reduce((sum, p) => sum + (hoursMap.get(p.id) ?? 0) / 60, 0);

  return (
    <div
      className={[
        "flex flex-col min-w-80 w-80",
        cfg.muted ? "opacity-60" : "",
      ].filter(Boolean).join(" ")}
    >
      {/* Header bar */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-card rounded-t-lg border border-b-0 border-gray-200">
        <div
          className="h-2.5 w-2.5 rounded-full shrink-0"
          style={{ backgroundColor: STATUS_COLOR[status] }}
        />
        <h3 className="text-sm font-semibold text-[#0f0f10] truncate flex-1">{cfg.label}</h3>
        <span className="text-xs text-[#787871] bg-gray-100 rounded-full px-2 py-0.5 font-medium">
          {projects.length}
        </span>
      </div>

      {/* Header divider */}
      <div className="h-px bg-gray-200" />

      {/* Droppable body */}
      <div
        ref={setNodeRef}
        className={[
          "flex-1 overflow-y-auto space-y-2 p-2 border border-t-0 bg-gray-50/40 transition-colors min-h-40",
          isOver
            ? "border-[#0f0f10] bg-[#0000170b]"
            : "border-gray-200",
        ].join(" ")}
      >
        {projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-center px-4">
            <div className="h-10 w-10 rounded-full bg-gray-100 flex items-center justify-center mb-2">
              <FolderOpen className="h-5 w-5 text-[#787871]" />
            </div>
            <p className="text-sm text-[#0f0f10] font-medium">No projects</p>
            <p className="text-xs text-[#787871] mt-0.5">Drag projects here to update</p>
          </div>
        ) : (
          projects.map((p) => (
            <ProjectCard key={p.id} project={p} teamMap={teamMap} hoursMap={hoursMap} />
          ))
        )}
      </div>

      {/* Column footer */}
      <div className="px-3 py-2 bg-card rounded-b-lg border border-t-0 border-gray-200 space-y-0.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-[#787871]">Total</span>
          <span className="font-medium text-[#0f0f10]">
            {projects.length} project{projects.length !== 1 ? "s" : ""}
          </span>
        </div>
        {projects.length > 0 && totalBillableHrs > 0 && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#787871]">Billable</span>
            <span className="font-medium text-[#0f0f10]">{totalBillableHrs.toFixed(1)} hrs</span>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { STATUS_COLOR } from "@/industries/it-agency/features/project-board/components/project-column";
import { PROJECT_STATUS_MAP } from "@/industries/it-agency/features/time-tracking/components/status-badge";
import type { ProjectStatus } from "@/types/database";

type ProjectStatusMix = Record<ProjectStatus, number>;

interface HealthSnapshotCardProps {
  isActive: boolean;
  projectStatusMix: ProjectStatusMix;
  openLeadsCount: number;
}

const STATUS_ORDER: ProjectStatus[] = ["planning", "active", "in_review", "delivered", "on_hold", "cancelled"];

export function HealthSnapshotCard({ isActive, projectStatusMix, openLeadsCount }: HealthSnapshotCardProps) {
  const totalProjects = Object.values(projectStatusMix).reduce((a, b) => a + b, 0);

  return (
    <div className="border border-border rounded-lg bg-card shadow-none p-3 space-y-3">
      <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Health</h3>
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Status</span>
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              isActive ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"
            }`}
          >
            {isActive ? "Active" : "Inactive"}
          </span>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Projects</span>
            <span className="font-medium" style={{ color: "#0f0f10" }}>{totalProjects}</span>
          </div>
          {totalProjects > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              {STATUS_ORDER.flatMap((status) =>
                Array.from({ length: projectStatusMix[status] }, (_, i) => (
                  <span
                    key={`${status}-${i}`}
                    title={PROJECT_STATUS_MAP[status].label}
                    className="h-2.5 w-2.5 rounded-full inline-block cursor-default"
                    style={{ backgroundColor: STATUS_COLOR[status] }}
                  />
                ))
              )}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Open leads</span>
          <span className="font-medium" style={{ color: "#0f0f10" }}>{openLeadsCount}</span>
        </div>
      </div>
    </div>
  );
}

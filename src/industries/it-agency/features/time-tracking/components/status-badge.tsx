"use client";

import { Badge } from "@/components/ui/badge";
import type { ProjectStatus, TaskStatus, ApprovalStatus } from "@/types/database";

const PROJECT_STATUS_MAP: Record<ProjectStatus, { label: string; className: string }> = {
  planning:   { label: "Planning",   className: "bg-slate-100 text-slate-700 border-slate-200" },
  active:     { label: "Active",     className: "bg-blue-50 text-blue-700 border-blue-200" },
  in_review:  { label: "In Review",  className: "bg-purple-50 text-purple-700 border-purple-200" },
  delivered:  { label: "Delivered",  className: "bg-green-50 text-green-700 border-green-200" },
  on_hold:    { label: "On Hold",    className: "bg-amber-50 text-amber-700 border-amber-200" },
  cancelled:  { label: "Cancelled",  className: "bg-red-50 text-red-600 border-red-200" },
};

const TASK_STATUS_MAP: Record<TaskStatus, { label: string; className: string }> = {
  todo:        { label: "To Do",       className: "bg-slate-100 text-slate-600 border-slate-200" },
  in_progress: { label: "In Progress", className: "bg-blue-50 text-blue-700 border-blue-200" },
  done:        { label: "Done",        className: "bg-green-50 text-green-700 border-green-200" },
};

const APPROVAL_STATUS_MAP: Record<ApprovalStatus, { label: string; className: string }> = {
  pending:  { label: "Pending",  className: "bg-amber-50 text-amber-700 border-amber-200" },
  approved: { label: "Approved", className: "bg-green-50 text-green-700 border-green-200" },
  rejected: { label: "Rejected", className: "bg-red-50 text-red-600 border-red-200" },
};

interface ProjectStatusBadgeProps {
  status: ProjectStatus;
}

export function ProjectStatusBadge({ status }: ProjectStatusBadgeProps) {
  const { label, className } = PROJECT_STATUS_MAP[status] ?? PROJECT_STATUS_MAP.active;
  return (
    <Badge variant="outline" className={className}>
      {label}
    </Badge>
  );
}

interface TaskStatusBadgeProps {
  status: TaskStatus;
}

export function TaskStatusBadge({ status }: TaskStatusBadgeProps) {
  const { label, className } = TASK_STATUS_MAP[status] ?? TASK_STATUS_MAP.todo;
  return (
    <Badge variant="outline" className={className}>
      {label}
    </Badge>
  );
}

interface ApprovalStatusBadgeProps {
  status: ApprovalStatus;
}

export function ApprovalStatusBadge({ status }: ApprovalStatusBadgeProps) {
  const { label, className } = APPROVAL_STATUS_MAP[status] ?? APPROVAL_STATUS_MAP.pending;
  return (
    <Badge variant="outline" className={className}>
      {label}
    </Badge>
  );
}

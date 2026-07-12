"use client";

import { useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import type { ProjectStatus, TaskStatus, TaskPriority } from "@/types/database";

export type WorkspaceView = "board" | "table" | "tasks" | "members";

export interface WorkspaceFilters {
  view: WorkspaceView;
  // Shared filters (all views)
  account: string;          // "__all__" or account.id
  q: string;
  // Board + Table only
  owner: string;            // "__all__" or auth user_id
  showCancelled: boolean;
  statuses: ProjectStatus[]; // empty = all visible
  // Tasks view only
  assignee: string;          // "__all__" or auth user_id
  taskStatuses: TaskStatus[]; // empty = all
  priorities: TaskPriority[]; // empty = all
  tags: string[];            // empty = all
  due: string;               // "__all__" | "overdue" | "today" | "this_week" | "none"
}

const ALL_PROJECT_STATUSES: ProjectStatus[] = [
  "planning",
  "active",
  "in_review",
  "delivered",
  "on_hold",
  "cancelled",
];

const ALL_TASK_STATUSES: TaskStatus[] = ["todo", "in_progress", "done"];
const ALL_PRIORITIES: TaskPriority[] = ["low", "normal", "high", "urgent"];

export function useWorkspaceFilters(defaultView: WorkspaceView = "board") {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const rawStatus = searchParams.get("status");
  const parsedStatuses: ProjectStatus[] = rawStatus
    ? (rawStatus.split(",").filter((s) => ALL_PROJECT_STATUSES.includes(s as ProjectStatus)) as ProjectStatus[])
    : [];

  const rawTaskStatus = searchParams.get("task_status");
  const parsedTaskStatuses: TaskStatus[] = rawTaskStatus
    ? (rawTaskStatus.split(",").filter((s) => ALL_TASK_STATUSES.includes(s as TaskStatus)) as TaskStatus[])
    : [];

  const rawPriority = searchParams.get("priority");
  const parsedPriorities: TaskPriority[] = rawPriority
    ? (rawPriority.split(",").filter((p) => ALL_PRIORITIES.includes(p as TaskPriority)) as TaskPriority[])
    : [];

  const rawTags = searchParams.get("tags");
  const parsedTags: string[] = rawTags ? rawTags.split(",").filter(Boolean) : [];

  const filters: WorkspaceFilters = {
    view: (searchParams.get("view") as WorkspaceView) || defaultView,
    account: searchParams.get("account") || "__all__",
    q: searchParams.get("q") || "",
    owner: searchParams.get("owner") || "__all__",
    showCancelled: searchParams.get("cancelled") === "1",
    statuses: parsedStatuses,
    assignee: searchParams.get("assignee") || "__all__",
    taskStatuses: parsedTaskStatuses,
    priorities: parsedPriorities,
    tags: parsedTags,
    due: searchParams.get("due") || "__all__",
  };

  const setFilters = useCallback(
    (next: Partial<WorkspaceFilters>) => {
      const params = new URLSearchParams(searchParams.toString());

      if (next.view !== undefined) params.set("view", next.view);

      if (next.account !== undefined) {
        if (next.account === "__all__") params.delete("account");
        else params.set("account", next.account);
      }

      if (next.q !== undefined) {
        if (next.q === "") params.delete("q");
        else params.set("q", next.q);
      }

      if (next.owner !== undefined) {
        if (next.owner === "__all__") params.delete("owner");
        else params.set("owner", next.owner);
      }

      if (next.showCancelled !== undefined) {
        if (next.showCancelled) params.set("cancelled", "1");
        else params.delete("cancelled");
      }

      if (next.statuses !== undefined) {
        if (next.statuses.length === 0) params.delete("status");
        else params.set("status", next.statuses.join(","));
      }

      if (next.assignee !== undefined) {
        if (next.assignee === "__all__") params.delete("assignee");
        else params.set("assignee", next.assignee);
      }

      if (next.taskStatuses !== undefined) {
        if (next.taskStatuses.length === 0) params.delete("task_status");
        else params.set("task_status", next.taskStatuses.join(","));
      }

      if (next.priorities !== undefined) {
        if (next.priorities.length === 0) params.delete("priority");
        else params.set("priority", next.priorities.join(","));
      }

      if (next.tags !== undefined) {
        if (next.tags.length === 0) params.delete("tags");
        else params.set("tags", next.tags.join(","));
      }

      if (next.due !== undefined) {
        if (next.due === "__all__") params.delete("due");
        else params.set("due", next.due);
      }

      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname]
  );

  return { filters, setFilters };
}

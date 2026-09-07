"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { deriveTaskContext, type TaskContextSource } from "@/lib/home/task-context";

interface TaskContextChipProps {
  task: TaskContextSource;
  /** Gates whether a project link is clickable — see deriveTaskContext. */
  projectBoardEnabled: boolean;
  className?: string;
}

/**
 * The one context-chip renderer for a task row, shared by every surface that
 * lists tasks (Home Overview's TasksCard, the Tasks tab, and the shared
 * dashboard TaskRow). See src/lib/home/task-context.ts for the precedence
 * rule this renders.
 */
export function TaskContextChip({ task, projectBoardEnabled, className }: TaskContextChipProps) {
  const ctx = deriveTaskContext(task, projectBoardEnabled);
  if (!ctx) return null;

  if (!ctx.href) {
    return (
      <span className={cn("text-xs text-muted-foreground truncate shrink-0", className)}>
        {ctx.label}
      </span>
    );
  }

  return (
    <Link
      href={ctx.href}
      prefetch={false}
      className={cn("text-xs text-blue-600 hover:underline truncate shrink-0", className)}
    >
      {ctx.label}
    </Link>
  );
}

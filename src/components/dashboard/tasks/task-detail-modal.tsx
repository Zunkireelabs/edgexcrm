"use client";

import { useRouter } from "next/navigation";
import { TaskDetailDrawer } from "./task-detail";

interface TaskDetailModalProps {
  taskId: string;
  currentUserId: string;
  isAdmin: boolean;
  canManageProjects: boolean;
}

/**
 * Rendered by the @modal intercepting route (@modal/(.)tasks/[id]/page.tsx)
 * when a task link is clicked from inside the app — same TaskDetailBody as
 * the full page, presented as a drawer. Esc / overlay click / browser-back
 * all resolve to onOpenChange(false), which router.back()s out of the
 * intercepted URL rather than navigating forward — see task-detail.tsx's
 * file header for the full picture (docs/IT-AGENCY-ROUND2-TASK-OBJECT-BRIEF.md §2).
 */
export function TaskDetailModal({ taskId, currentUserId, isAdmin, canManageProjects }: TaskDetailModalProps) {
  const router = useRouter();

  return (
    <TaskDetailDrawer
      taskId={taskId}
      open
      onOpenChange={(open) => {
        if (!open) router.back();
      }}
      currentUserId={currentUserId}
      isAdmin={isAdmin}
      canManageProjects={canManageProjects}
    />
  );
}

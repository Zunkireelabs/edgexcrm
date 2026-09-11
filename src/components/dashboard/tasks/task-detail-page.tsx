"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TaskDetailBody } from "./task-detail";

interface TaskDetailPageProps {
  taskId: string;
  currentUserId: string;
  isAdmin: boolean;
  canManageProjects: boolean;
}

/**
 * The full-page presentation at /tasks/[id] — a direct load (email link,
 * pasted link) renders this instead of the drawer. Same TaskDetailBody as
 * the @modal intercepting route uses; see task-detail.tsx's file header.
 */
export function TaskDetailPage({ taskId, currentUserId, isAdmin, canManageProjects }: TaskDetailPageProps) {
  const router = useRouter();

  return (
    <div className="max-w-2xl mx-auto py-6 px-4">
      <Button
        variant="ghost"
        size="sm"
        className="mb-4 -ml-2 text-muted-foreground"
        onClick={() => (window.history.length > 1 ? router.back() : router.push("/home"))}
      >
        <ArrowLeft className="h-4 w-4 mr-1.5" />
        Back
      </Button>
      <div className="border border-border rounded-xl bg-background flex flex-col overflow-hidden">
        <TaskDetailBody
          key={taskId}
          taskId={taskId}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          canManageProjects={canManageProjects}
          presentation="page"
          onDeleted={() => router.push("/home")}
        />
      </div>
    </div>
  );
}

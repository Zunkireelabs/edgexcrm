"use client";

import { TaskComposer } from "@/components/dashboard/tasks/task-composer";

interface NewTaskRowProps {
  currentUserId: string;
  onCreated: (task: Record<string, unknown>) => void;
}

export function NewTaskRow({ currentUserId, onCreated }: NewTaskRowProps) {
  return <TaskComposer currentUserId={currentUserId} onCreated={onCreated} triggerLabel="New Task" />;
}

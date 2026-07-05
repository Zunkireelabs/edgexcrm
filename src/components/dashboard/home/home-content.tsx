"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { GreetingHeader } from "./greeting-header";
import { AttentionSummary } from "./attention-summary";
import { ScheduleCard } from "./schedule-card";
import { TasksCard } from "./tasks-card";
import { MyLeadsCard } from "./my-leads-card";
import { InboxSnapshotCard } from "./inbox-snapshot-card";
import { RecentActivityCard } from "./recent-activity-card";
import type { ScheduleActivity, PersonalTask, MyTasksResult, InboxSnapshot, RecentActivityItem } from "@/lib/supabase/queries";
import type { Lead, TaskStatus } from "@/types/database";

interface HomeContentProps {
  userId: string;
  userName: string;
  schedule: ScheduleActivity[];
  tasks: MyTasksResult;
  myLeads: Lead[];
  recentActivity: RecentActivityItem[];
  inboxSnapshot: InboxSnapshot;
  isEducation: boolean;
}

export function HomeContent({
  userId,
  userName,
  schedule,
  tasks,
  myLeads,
  recentActivity,
  inboxSnapshot,
}: HomeContentProps) {
  const router = useRouter();
  const [openTasks, setOpenTasks] = useState<PersonalTask[]>(tasks.open);
  const [doneTasks, setDoneTasks] = useState<PersonalTask[]>(tasks.done);

  const handleComplete = useCallback(async (id: string) => {
    const res = await fetch(`/api/v1/my-tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    });
    if (res.ok) {
      const task = openTasks.find((t) => t.id === id);
      if (task) {
        setOpenTasks((prev) => prev.filter((t) => t.id !== id));
        setDoneTasks((prev) => [{ ...task, status: "done" as TaskStatus }, ...prev].slice(0, 10));
      }
      router.refresh();
    }
  }, [openTasks, router]);

  const handleDelete = useCallback(async (id: string) => {
    const res = await fetch(`/api/v1/my-tasks/${id}`, { method: "DELETE" });
    if (res.ok) {
      setOpenTasks((prev) => prev.filter((t) => t.id !== id));
      setDoneTasks((prev) => prev.filter((t) => t.id !== id));
      router.refresh();
    }
  }, [router]);

  const handleCreated = useCallback((task: Record<string, unknown>) => {
    // Only surface it here if it's actually assigned to me — assigning a task to
    // someone else from Home shouldn't add it to MY open-tasks list.
    if (task.assignee_id === userId) {
      setOpenTasks((prev) => [task as unknown as PersonalTask, ...prev]);
    }
    router.refresh();
  }, [router, userId]);

  return (
    <div className="px-4 py-6">
      <GreetingHeader userName={userName} />

      <AttentionSummary openTasks={openTasks} schedule={schedule} inboxSnapshot={inboxSnapshot} />

      <div className="space-y-4">
        <ScheduleCard schedule={schedule} />
        <TasksCard
          initialOpen={openTasks}
          initialDone={doneTasks}
          currentUserId={userId}
          onComplete={handleComplete}
          onDelete={handleDelete}
          onCreated={handleCreated}
        />
        <MyLeadsCard leads={myLeads} />
        <InboxSnapshotCard snapshot={inboxSnapshot} />
        <RecentActivityCard notifications={recentActivity} />
      </div>
    </div>
  );
}

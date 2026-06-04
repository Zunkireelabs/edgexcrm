"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { GreetingHeader } from "./greeting-header";
import { ScheduleCard } from "./schedule-card";
import { TasksCard } from "./tasks-card";
import { MyLeadsCard } from "./my-leads-card";
import { EmailSnapshotCard } from "./email-snapshot-card";
import { RecentActivityCard } from "./recent-activity-card";
import type { ScheduleActivity, PersonalTask, MyTasksResult, EmailSnapshot, RecentNotification } from "@/lib/supabase/queries";
import type { Lead, TaskPriority, TaskStatus } from "@/types/database";

interface HomeContentProps {
  userName: string;
  schedule: ScheduleActivity[];
  tasks: MyTasksResult;
  myLeads: Lead[];
  notifications: RecentNotification[];
  emailSnapshot: EmailSnapshot | null;
  isEducation: boolean;
}

export function HomeContent({
  userName,
  schedule,
  tasks,
  myLeads,
  notifications,
  emailSnapshot,
  isEducation,
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

  const handleAdd = useCallback(async (newTask: { title: string; due_date: string | null; priority: TaskPriority }) => {
    const res = await fetch("/api/v1/my-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newTask),
    });
    if (res.ok) {
      const { data } = await res.json();
      setOpenTasks((prev) => [data as PersonalTask, ...prev]);
      router.refresh();
    }
  }, [router]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <GreetingHeader userName={userName} />

      <div className="space-y-4">
        <ScheduleCard schedule={schedule} />
        <TasksCard
          initialOpen={openTasks}
          initialDone={doneTasks}
          onComplete={handleComplete}
          onDelete={handleDelete}
          onAdd={handleAdd}
        />
        <MyLeadsCard leads={myLeads} />
        {isEducation && emailSnapshot && (
          <EmailSnapshotCard snapshot={emailSnapshot} />
        )}
        <RecentActivityCard notifications={notifications} />
      </div>
    </div>
  );
}

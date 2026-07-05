"use client";

import { AlertCircle } from "lucide-react";
import type { ScheduleActivity, PersonalTask, InboxSnapshot } from "@/lib/supabase/queries";
import { toLocalDateString } from "@/lib/date";

interface AttentionSummaryProps {
  openTasks: PersonalTask[];
  schedule: ScheduleActivity[];
  inboxSnapshot: InboxSnapshot;
}

export function AttentionSummary({ openTasks, schedule, inboxSnapshot }: AttentionSummaryProps) {
  const today = toLocalDateString(new Date());
  const overdueTasks = openTasks.filter((t) => t.due_date !== null && t.due_date < today).length;

  const now = new Date().toISOString();
  const overdueFollowUps = schedule.filter((a) => a.scheduled_at < now).length;

  const unread = inboxSnapshot.unreadCount;

  const total = overdueTasks + overdueFollowUps + unread;
  if (total === 0) return null;

  const parts = [
    overdueTasks > 0 ? `${overdueTasks} overdue ${overdueTasks === 1 ? "task" : "tasks"}` : null,
    overdueFollowUps > 0 ? `${overdueFollowUps} overdue ${overdueFollowUps === 1 ? "follow-up" : "follow-ups"}` : null,
    unread > 0 ? `${unread} unread` : null,
  ].filter(Boolean);

  return (
    <div className="flex items-center gap-2 mb-4 text-sm">
      <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
      <span className="font-medium text-amber-700">
        {total} {total === 1 ? "item needs" : "items need"} attention
      </span>
      <span className="text-muted-foreground">· {parts.join(" · ")}</span>
    </div>
  );
}

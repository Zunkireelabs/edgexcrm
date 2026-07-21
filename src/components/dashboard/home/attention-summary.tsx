"use client";

import Link from "next/link";
import { AlertCircle } from "lucide-react";
import type { ScheduleActivity, PersonalTask, InboxSnapshot, LeaveHomeSummary } from "@/lib/supabase/queries";
import { toLocalDateString } from "@/lib/date";

interface AttentionSummaryProps {
  openTasks: PersonalTask[];
  schedule: ScheduleActivity[];
  inboxSnapshot: InboxSnapshot;
  leaveSummary: LeaveHomeSummary;
  outreachDue: number;
}

export function AttentionSummary({ openTasks, schedule, inboxSnapshot, leaveSummary, outreachDue }: AttentionSummaryProps) {
  const today = toLocalDateString(new Date());
  const overdueTasks = openTasks.filter((t) => t.due_date !== null && t.due_date < today).length;

  const now = new Date().toISOString();
  const overdueFollowUps = schedule.filter((a) => a.scheduled_at < now).length;

  const unread = inboxSnapshot.unreadCount;
  const { pendingLeaveApprovals, myPendingLeave } = leaveSummary;

  const total = overdueTasks + overdueFollowUps + unread + pendingLeaveApprovals + myPendingLeave + outreachDue;
  if (total === 0) return null;

  const parts = [
    overdueTasks > 0 ? `${overdueTasks} overdue ${overdueTasks === 1 ? "task" : "tasks"}` : null,
    overdueFollowUps > 0 ? `${overdueFollowUps} overdue ${overdueFollowUps === 1 ? "follow-up" : "follow-ups"}` : null,
    unread > 0 ? `${unread} unread` : null,
    outreachDue > 0 ? (
      <Link key="outreach-due" href="/outreach" className="underline hover:text-amber-700">
        {outreachDue} outreach {outreachDue === 1 ? "email" : "emails"} due
      </Link>
    ) : null,
    pendingLeaveApprovals > 0 ? (
      <Link key="leave-approvals" href="/leave" className="underline hover:text-amber-700">
        {pendingLeaveApprovals} leave {pendingLeaveApprovals === 1 ? "approval" : "approvals"}
      </Link>
    ) : null,
    myPendingLeave > 0 ? (
      <Link key="my-leave" href="/leave" className="underline hover:text-amber-700">
        {myPendingLeave} of your leave {myPendingLeave === 1 ? "request" : "requests"} pending
      </Link>
    ) : null,
  ].filter(Boolean);

  return (
    <div className="flex items-center gap-2 mb-4 text-sm flex-wrap">
      <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
      <span className="font-medium text-amber-700">
        {total} {total === 1 ? "item needs" : "items need"} attention
      </span>
      <span className="text-muted-foreground">
        ·{" "}
        {parts.map((part, i) => (
          <span key={i}>
            {part}
            {i < parts.length - 1 ? " · " : ""}
          </span>
        ))}
      </span>
    </div>
  );
}

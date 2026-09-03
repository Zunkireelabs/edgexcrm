"use client";

import Link from "next/link";
import { CalendarDays, Clock, Users } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { toLocalDateString } from "@/lib/date";
import type { ScheduleActivity } from "@/lib/supabase/queries";

interface ScheduleTabContentProps {
  schedule: ScheduleActivity[];
}

const AVATAR_COLORS = [
  "bg-purple-50 text-purple-600",
  "bg-green-50 text-green-600",
  "bg-orange-50 text-orange-600",
  "bg-blue-50 text-blue-600",
];

function leadName(activity: ScheduleActivity) {
  if (!activity.leads) return null;
  return [activity.leads.first_name, activity.leads.last_name].filter(Boolean).join(" ") || null;
}

function MeetingRow({ activity, index }: { activity: ScheduleActivity; index: number }) {
  const name = leadName(activity);
  const date = new Date(activity.scheduled_at);
  const dayStr = date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const timeStr = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  const row = (
    <>
      <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", AVATAR_COLORS[index % AVATAR_COLORS.length])}>
        <Users className="h-4 w-4" />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{activity.subject ?? "No subject"}</p>
        {name && <p className="text-xs text-muted-foreground truncate">With {name}</p>}
      </div>
      <div className="flex flex-col items-end gap-0.5 shrink-0 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <CalendarDays className="h-3 w-3" />
          {dayStr}
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {timeStr}
        </span>
      </div>
    </>
  );

  if (activity.lead_id) {
    return (
      <Link
        href={`/leads/${activity.lead_id}`}
        prefetch={false}
        className="flex items-center gap-3 py-2.5 px-1 rounded-md hover:bg-muted/50 transition-colors"
      >
        {row}
      </Link>
    );
  }

  return <div className="flex items-center gap-3 py-2.5 px-1 rounded-md">{row}</div>;
}

export function ScheduleTabContent({ schedule }: ScheduleTabContentProps) {
  const today = toLocalDateString(new Date());
  const now = new Date().toISOString();

  const todaysMeetings = schedule.filter(
    (a) => toLocalDateString(new Date(a.scheduled_at)) === today,
  );
  const upcomingMeetings = schedule.filter(
    (a) => a.scheduled_at >= now && toLocalDateString(new Date(a.scheduled_at)) !== today,
  );

  return (
    <div className="space-y-4">
      <Card className="border-sidebar-border rounded-xl">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Today&apos;s Meetings</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {todaysMeetings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 gap-2 text-center">
              <CalendarDays className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No meetings scheduled for today.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {todaysMeetings.map((a, i) => (
                <MeetingRow key={a.id} activity={a} index={i} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-sidebar-border rounded-xl">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Upcoming Meetings</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {upcomingMeetings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 gap-2 text-center">
              <CalendarDays className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No upcoming meetings.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {upcomingMeetings.map((a, i) => (
                <MeetingRow key={a.id} activity={a} index={i} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

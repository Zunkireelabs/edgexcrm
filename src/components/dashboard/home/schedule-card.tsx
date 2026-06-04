"use client";

import Link from "next/link";
import { Phone, CalendarDays, AlertCircle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/format-relative-time";
import type { ScheduleActivity } from "@/lib/supabase/queries";

interface ScheduleCardProps {
  schedule: ScheduleActivity[];
}

export function ScheduleCard({ schedule }: ScheduleCardProps) {
  const now = new Date().toISOString();
  const overdue = schedule.filter((a) => a.scheduled_at < now);
  const upcoming = schedule.filter((a) => a.scheduled_at >= now);

  const empty = schedule.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">Schedule</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {empty ? (
          <div className="flex flex-col items-center justify-center py-6 gap-2 text-center">
            <CalendarDays className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {overdue.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  Overdue
                </p>
                <div className="space-y-1">
                  {overdue.map((a) => (
                    <ActivityRow key={a.id} activity={a} isOverdue />
                  ))}
                </div>
              </div>
            )}
            {upcoming.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  Upcoming
                </p>
                <div className="space-y-1">
                  {upcoming.map((a) => (
                    <ActivityRow key={a.id} activity={a} isOverdue={false} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityRow({
  activity,
  isOverdue,
}: {
  activity: ScheduleActivity;
  isOverdue: boolean;
}) {
  const Icon = activity.activity_type === "call" ? Phone : CalendarDays;
  const leadName = activity.leads
    ? [activity.leads.first_name, activity.leads.last_name].filter(Boolean).join(" ") || "Lead"
    : null;

  const timeStr = new Date(activity.scheduled_at).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="flex items-start gap-3 py-2 px-1 rounded-md hover:bg-gray-50 transition-colors">
      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${isOverdue ? "text-red-500" : "text-blue-500"}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">
          {activity.subject ?? "No subject"}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          {isOverdue ? (
            <span className="inline-flex items-center gap-1 text-xs text-red-600 font-medium">
              <AlertCircle className="h-3 w-3" />
              overdue
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">{timeStr}</span>
          )}
          {activity.location && (
            <span className="text-xs text-muted-foreground truncate">· {activity.location}</span>
          )}
        </div>
      </div>
      {leadName && activity.lead_id && (
        <Link
          href={`/leads/${activity.lead_id}`}
          className="text-xs text-blue-600 hover:underline shrink-0"
        >
          {leadName}
        </Link>
      )}
      {!leadName && (
        <span className="text-xs text-muted-foreground shrink-0">
          {formatRelativeTime(activity.scheduled_at)}
        </span>
      )}
    </div>
  );
}

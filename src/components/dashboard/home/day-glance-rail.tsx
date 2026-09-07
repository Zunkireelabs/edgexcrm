"use client";

import Link from "next/link";
import { CalendarDays, CheckCircle2, AlertCircle, Activity, MessageSquare, Lightbulb, Plus, Send, ListTodo } from "lucide-react";
import { CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { HomeTip } from "@/lib/home/tips";

interface DayGlanceRailProps {
  meetingsCount: number;
  tasksDueTodayCount: number;
  overdueCount: number;
  activitiesCount: number;
  unreadCount: number;
  applicationTrackingEnabled: boolean;
  tip: HomeTip;
  onNewTaskClick: () => void;
  onOverdueClick: () => void;
  className?: string;
}

const STATS_CONFIG = [
  { key: "meetings", icon: CalendarDays, label: "Meetings" },
  { key: "tasksDueToday", icon: CheckCircle2, label: "Tasks due today" },
  { key: "overdue", icon: AlertCircle, label: "Overdue" },
  { key: "activities", icon: Activity, label: "Activities" },
  { key: "unread", icon: MessageSquare, label: "Unread messages" },
] as const;

export function DayGlanceRail({
  meetingsCount,
  tasksDueTodayCount,
  overdueCount,
  activitiesCount,
  unreadCount,
  applicationTrackingEnabled,
  tip,
  onNewTaskClick,
  onOverdueClick,
  className,
}: DayGlanceRailProps) {
  const values: Record<(typeof STATS_CONFIG)[number]["key"], number> = {
    meetings: meetingsCount,
    tasksDueToday: tasksDueTodayCount,
    overdue: overdueCount,
    activities: activitiesCount,
    unread: unreadCount,
  };

  return (
    <div className={cn("lg:sticky lg:top-6 lg:h-[calc(100vh_-_140px)] lg:overflow-y-auto lg:overflow-x-hidden lg:[scrollbar-gutter:stable] lg:shrink-0 lg:border-l lg:border-border lg:pl-6 pt-16", className)}>
      <div className="space-y-6 flex-1 flex flex-col h-full">
        <div>
          <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-4">
            Your day at a glance
          </CardTitle>
          <div className="grid grid-cols-2 gap-3">
            {STATS_CONFIG.map(({ key, icon: Icon, label }, index) => {
              // Overdue is clickable (opens the Tasks tab pre-filtered) but stays the same
              // visual weight as the others — three overdue follow-ups on a Monday is
              // normal, not an incident, so no red alarm treatment here.
              const isOverdue = key === "overdue";
              // An odd tile count leaves the last one alone on its own row at
              // half width in a 2-col grid — span it full width instead of
              // leaving it dangling next to empty space.
              const isLast = index === STATS_CONFIG.length - 1;
              const spanClass = isLast && STATS_CONFIG.length % 2 === 1 ? "col-span-2" : "";
              const content = (
                <>
                  <Icon className="h-5 w-5 text-muted-foreground shrink-0 self-center" />
                  <div className="flex-1 text-center">
                    <p className="text-lg font-semibold leading-none text-foreground">{values[key]}</p>
                    <p className="text-xs text-muted-foreground mt-1">{label}</p>
                  </div>
                </>
              );
              return isOverdue ? (
                <button
                  key={key}
                  type="button"
                  onClick={onOverdueClick}
                  className={cn("flex items-start gap-2 rounded-lg border-0 bg-sidebar-bg shadow-sm px-3 py-2.5 text-left hover:bg-muted transition-colors", spanClass)}
                >
                  {content}
                </button>
              ) : (
                <div key={key} className={cn("flex items-start gap-2 rounded-lg border-0 bg-sidebar-bg shadow-sm px-3 py-2.5", spanClass)}>
                  {content}
                </div>
              );
            })}
          </div>
        </div>

        <div className="border-t border-border pt-6">
          <CardTitle className="text-sm font-semibold mb-4">Quick actions</CardTitle>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="sm" className="w-full min-w-0 justify-start rounded-[8px]" asChild>
              <Link href="/leads">
                <Plus className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Add Lead</span>
              </Link>
            </Button>
            <Button variant="outline" size="sm" className="w-full min-w-0 justify-start rounded-[8px]" onClick={onNewTaskClick}>
              <ListTodo className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">New Task</span>
            </Button>
            {applicationTrackingEnabled && (
              <Button variant="outline" size="sm" className="w-full min-w-0 justify-start rounded-[8px]" asChild>
                <Link href="/applications">
                  <Plus className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Add Application</span>
                </Link>
              </Button>
            )}
            <Button variant="outline" size="sm" className="w-full min-w-0 justify-start rounded-[8px]" asChild>
              <Link href="/inbox">
                <Send className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Send Message</span>
              </Link>
            </Button>
          </div>
        </div>

        <TipOfTheDaySection tip={tip} />
        <div className="flex-1" />
      </div>
    </div>
  );
}

function TipOfTheDaySection({ tip }: { tip: HomeTip }) {
  return (
    <div className="border-t border-border pt-6">
      <div className="rounded-lg p-4 flex items-start gap-3 bg-blue-50/60 dark:bg-blue-950/20">
        <Lightbulb className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground mb-1">Reminder</p>
          <p className="text-sm text-muted-foreground">{tip.text}</p>
        </div>
      </div>
    </div>
  );
}

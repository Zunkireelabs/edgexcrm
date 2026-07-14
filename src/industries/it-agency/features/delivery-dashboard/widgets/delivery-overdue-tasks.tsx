"use client";

import { useWidgetData } from "@/industries/_shared/features/insights/lib/use-widget-data";
import { WidgetCard, WidgetLoading, WidgetEmpty, WidgetError } from "./widget-shell";

// Overdue Tasks — no new endpoint, reuses GET /api/v1/tasks?due=overdue (the tasks
// route already resolves the "overdue" keyword to due_date < today). status=todo,in_progress
// excludes done tasks — the route's due=overdue filter is date-only and doesn't
// exclude completed work on its own.
interface ProjectEmbed {
  id: string;
  name: string;
}

interface TaskRow {
  id: string;
  title: string;
  assignee_id: string | null;
  due_date: string | null;
  projects: ProjectEmbed | ProjectEmbed[] | null;
}

interface TeamMemberMinimal {
  user_id: string;
  name: string;
}

function projectOf(embed: ProjectEmbed | ProjectEmbed[] | null): ProjectEmbed | null {
  return Array.isArray(embed) ? (embed[0] ?? null) : embed;
}

function toUTCMidnightMs(dateISO: string): number {
  const [year, month, day] = dateISO.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function daysOverdue(dueDate: string): number {
  const todayISO = new Intl.DateTimeFormat("en-CA").format(new Date());
  return Math.round((toUTCMidnightMs(todayISO) - toUTCMidnightMs(dueDate)) / (1000 * 60 * 60 * 24));
}

export default function DeliveryOverdueTasksWidget() {
  const { data: tasks, loading: tasksLoading, error } = useWidgetData<TaskRow[]>(
    "/api/v1/tasks?due=overdue&status=todo,in_progress&page_size=200"
  );
  const { data: team, loading: teamLoading } = useWidgetData<TeamMemberMinimal[]>("/api/v1/team?minimal=1");

  const loading = tasksLoading || teamLoading;
  const nameByUserId = new Map((team ?? []).map((m) => [m.user_id, m.name]));

  const sorted = [...(tasks ?? [])]
    .filter((t) => t.due_date)
    .sort((a, b) => daysOverdue(b.due_date!) - daysOverdue(a.due_date!));

  const byAssignee = new Map<string, TaskRow[]>();
  for (const t of sorted) {
    const key = t.assignee_id ?? "__unassigned__";
    const list = byAssignee.get(key) ?? [];
    list.push(t);
    byAssignee.set(key, list);
  }
  const groupCount = byAssignee.size;

  return (
    <WidgetCard title="Overdue Tasks">
      {loading ? (
        <WidgetLoading />
      ) : error ? (
        <WidgetError message="Failed to load overdue tasks." />
      ) : sorted.length === 0 ? (
        <WidgetEmpty message="Nothing overdue right now." />
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {sorted.length} task{sorted.length === 1 ? "" : "s"} overdue across {groupCount} assignee{groupCount === 1 ? "" : "s"}
          </p>
          <ul className="space-y-1.5">
            {sorted.slice(0, 8).map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate">
                  <span className="font-medium">{t.assignee_id ? (nameByUserId.get(t.assignee_id) ?? "Unknown") : "Unassigned"}</span>
                  <span className="text-muted-foreground"> — {t.title}</span>
                  {projectOf(t.projects) && <span className="text-muted-foreground/70"> ({projectOf(t.projects)?.name})</span>}
                </span>
                <span className="text-red-600 font-medium flex-shrink-0">{daysOverdue(t.due_date!)}d</span>
              </li>
            ))}
          </ul>
          {sorted.length > 8 && (
            <p className="text-xs text-muted-foreground">+{sorted.length - 8} more</p>
          )}
        </div>
      )}
    </WidgetCard>
  );
}

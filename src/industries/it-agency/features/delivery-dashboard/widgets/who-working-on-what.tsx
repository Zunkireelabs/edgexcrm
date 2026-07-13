"use client";

import { useWidgetData } from "@/industries/_shared/features/insights/lib/use-widget-data";
import { WidgetCard, WidgetLoading, WidgetEmpty, WidgetError } from "./widget-shell";

interface ProjectEmbed {
  id: string;
  name: string;
}

interface TaskRow {
  id: string;
  title: string;
  assignee_id: string | null;
  projects: ProjectEmbed | ProjectEmbed[] | null;
}

interface TeamMemberMinimal {
  user_id: string;
  name: string;
}

function projectOf(embed: ProjectEmbed | ProjectEmbed[] | null): ProjectEmbed | null {
  return Array.isArray(embed) ? (embed[0] ?? null) : embed;
}

export default function WhoWorkingOnWhatWidget() {
  const { data: tasks, loading: tasksLoading, error } = useWidgetData<TaskRow[]>(
    "/api/v1/tasks?status=in_progress&page_size=200"
  );
  const { data: team, loading: teamLoading } = useWidgetData<TeamMemberMinimal[]>("/api/v1/team?minimal=1");

  const loading = tasksLoading || teamLoading;

  return (
    <WidgetCard title="Who's Working on What">
      {loading ? (
        <WidgetLoading />
      ) : error ? (
        <WidgetError message="Failed to load tasks." />
      ) : !tasks || tasks.length === 0 ? (
        <WidgetEmpty message="No in-progress tasks right now." />
      ) : (
        <WhoWorkingOnWhatContent tasks={tasks} team={team ?? []} />
      )}
    </WidgetCard>
  );
}

function WhoWorkingOnWhatContent({ tasks, team }: { tasks: TaskRow[]; team: TeamMemberMinimal[] }) {
  const nameByUserId = new Map(team.map((m) => [m.user_id, m.name]));

  const byAssignee = new Map<string, TaskRow[]>();
  for (const t of tasks) {
    const key = t.assignee_id ?? "__unassigned__";
    const list = byAssignee.get(key) ?? [];
    list.push(t);
    byAssignee.set(key, list);
  }

  const groups = Array.from(byAssignee.entries())
    .map(([assigneeId, group]) => ({
      assigneeId,
      name: assigneeId === "__unassigned__" ? "Unassigned" : nameByUserId.get(assigneeId) ?? "Unknown",
      tasks: group,
    }))
    .sort((a, b) => b.tasks.length - a.tasks.length);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {groups.map((g) => (
        <div key={g.assigneeId} className="border rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">{g.name}</span>
            <span className="text-xs text-muted-foreground">{g.tasks.length} task{g.tasks.length === 1 ? "" : "s"}</span>
          </div>
          <ul className="space-y-1">
            {g.tasks.map((t) => (
              <li key={t.id} className="text-xs text-muted-foreground truncate">
                {t.title}
                {projectOf(t.projects) && <span className="text-muted-foreground/70"> — {projectOf(t.projects)?.name}</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

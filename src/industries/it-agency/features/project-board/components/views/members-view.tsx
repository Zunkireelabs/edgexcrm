"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { toast } from "sonner";
import { ChevronRight, ChevronDown, Users } from "lucide-react";
import { StatusPill } from "../status-pill";
import { PriorityPill } from "../priority-pill";
import type { Account, Task, TaskPriority, ProjectStatus } from "@/types/database";
import type { TeamMember, ProjectWithMetrics } from "../../hooks/use-projects";
import type { WorkspaceFilters } from "../../hooks/use-workspace-filters";

interface TaskWithProject extends Task {
  projects: {
    id: string;
    name: string;
    account_id: string;
    accounts: { id: string; name: string } | null;
  } | null;
}

interface MemberSection {
  member: TeamMember;
  ownedProjects: Array<ProjectWithMetrics & { account_name: string }>;
  openTasks: TaskWithProject[];
}

function initials(email: string): string {
  const parts = email.split("@")[0].split(/[._-]/);
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function matchesDue(dueDate: string | null, keyword: string): boolean {
  if (keyword === "__all__") return true;
  const today = new Date().toISOString().split("T")[0];
  if (keyword === "none") return dueDate === null;
  if (keyword === "overdue") return dueDate !== null && dueDate < today;
  if (keyword === "today") return dueDate === today;
  if (keyword === "this_week") {
    const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    return dueDate !== null && dueDate >= today && dueDate <= nextWeek;
  }
  return true;
}

interface MembersViewProps {
  filters: WorkspaceFilters;
  team: TeamMember[];
  projects: ProjectWithMetrics[];
  accountMap: Map<string, Account>;
}

export function MembersView({ filters, team, projects, accountMap }: MembersViewProps) {
  const [allTasks, setAllTasks] = useState<TaskWithProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [initialized, setInitialized] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/tasks?page_size=200");
      if (!res.ok) throw new Error("Failed to fetch tasks");
      const { data } = await res.json();
      setAllTasks((data ?? []) as TaskWithProject[]);
    } catch {
      toast.error("Failed to load member tasks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sections = useMemo<MemberSection[]>(() => {
    const q = filters.q.toLowerCase();

    // Group projects by owner_id (apply account + search filters; exclude cancelled)
    const projectsByOwner = new Map<string, Array<ProjectWithMetrics>>();
    for (const p of projects) {
      if (!p.owner_id) continue;
      if (p.status === "cancelled") continue;
      if (filters.account !== "__all__" && p.account_id !== filters.account) continue;
      if (q && !p.name.toLowerCase().includes(q)) continue;
      const list = projectsByOwner.get(p.owner_id) ?? [];
      list.push(p);
      projectsByOwner.set(p.owner_id, list);
    }

    // Group open tasks by assignee_id (apply account + search + priority + due filters)
    const tasksByAssignee = new Map<string, TaskWithProject[]>();
    for (const t of allTasks) {
      if (!t.assignee_id) continue;
      if (t.status === "done") continue;
      if (filters.account !== "__all__" && t.projects?.account_id !== filters.account) continue;
      if (q && !t.title.toLowerCase().includes(q)) continue;
      if (filters.priorities.length > 0 && !filters.priorities.includes(t.priority as TaskPriority))
        continue;
      if (!matchesDue(t.due_date, filters.due)) continue;
      const list = tasksByAssignee.get(t.assignee_id) ?? [];
      list.push(t);
      tasksByAssignee.set(t.assignee_id, list);
    }

    const result: MemberSection[] = [];

    for (const member of team) {
      // Owner filter narrows the section list
      if (filters.owner !== "__all__" && member.user_id !== filters.owner) continue;

      const ownedProjects = (projectsByOwner.get(member.user_id) ?? []).map((p) => ({
        ...p,
        account_name: accountMap.get(p.account_id)?.name ?? "Unknown account",
      }));
      const openTasks = tasksByAssignee.get(member.user_id) ?? [];

      if (ownedProjects.length === 0 && openTasks.length === 0) continue;

      result.push({ member, ownedProjects, openTasks });
    }

    // Sort: open tasks desc → owned projects desc → email asc
    result.sort((a, b) => {
      const taskDiff = b.openTasks.length - a.openTasks.length;
      if (taskDiff !== 0) return taskDiff;
      const projDiff = b.ownedProjects.length - a.ownedProjects.length;
      if (projDiff !== 0) return projDiff;
      return a.member.email.localeCompare(b.member.email);
    });

    return result;
  }, [team, projects, allTasks, accountMap, filters]);

  // Initialize expanded state once after first load: expand members with open tasks
  useEffect(() => {
    if (loading || initialized) return;
    setInitialized(true);
    setExpandedIds(
      new Set(sections.filter((s) => s.openTasks.length > 0).map((s) => s.member.user_id))
    );
  }, [loading, sections, initialized]);

  function toggleExpand(userId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        Loading members…
      </div>
    );
  }

  if (sections.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
        <Users className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          No members have owned projects or assigned tasks yet.
        </p>
        <p className="text-xs text-muted-foreground">
          Admins assign owners in the Table view.
        </p>
      </div>
    );
  }

  const today = new Date().toISOString().split("T")[0];

  return (
    <div className="flex flex-col gap-3">
      {sections.map(({ member, ownedProjects, openTasks }) => {
        const expanded = expandedIds.has(member.user_id);

        return (
          <div key={member.user_id} className="border border-gray-200 rounded-lg overflow-hidden">
            {/* Section header — click to expand/collapse */}
            <button
              type="button"
              onClick={() => toggleExpand(member.user_id)}
              className="w-full flex items-center gap-3 px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
            >
              {expanded ? (
                <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
              )}
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-700 text-xs font-bold shrink-0">
                {initials(member.email)}
              </span>
              <span className="text-sm font-medium text-gray-900 truncate flex-1">
                {member.email}
              </span>
              <span className="text-xs text-muted-foreground ml-2 shrink-0 whitespace-nowrap">
                Projects ({ownedProjects.length}) &nbsp;·&nbsp; Open tasks ({openTasks.length})
              </span>
            </button>

            {/* Section body */}
            {expanded && (
              <div className="divide-y divide-gray-100">
                {/* Projects sub-section */}
                {ownedProjects.length > 0 && (
                  <div className="px-4 py-3">
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
                      Projects ({ownedProjects.length}) — owner
                    </p>
                    <div className="flex flex-col gap-1">
                      {ownedProjects.map((p) => (
                        <div key={p.id} className="flex items-center gap-3 py-1 min-w-0">
                          <a
                            href={`/time-tracking/projects/${p.id}`}
                            className="text-sm text-blue-600 hover:underline font-medium truncate flex-1 min-w-0"
                          >
                            {p.name}
                          </a>
                          <span className="text-xs text-muted-foreground truncate max-w-[140px] shrink-0">
                            {p.account_name}
                          </span>
                          <StatusPill status={p.status as ProjectStatus} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tasks sub-section */}
                {openTasks.length > 0 && (
                  <div className="px-4 py-3">
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
                      Tasks ({openTasks.length}) — open
                    </p>
                    <div className="flex flex-col gap-1">
                      {[...openTasks]
                        .sort((a, b) => {
                          // due_date asc, nulls last
                          if (!a.due_date && !b.due_date) return 0;
                          if (!a.due_date) return 1;
                          if (!b.due_date) return -1;
                          return a.due_date.localeCompare(b.due_date);
                        })
                        .map((t) => {
                          const isOverdue = t.due_date !== null && t.due_date < today;
                          return (
                            <div key={t.id} className="flex items-center gap-3 py-1 min-w-0">
                              <a
                                href={
                                  t.projects
                                    ? `/time-tracking/projects/${t.projects.id}`
                                    : "#"
                                }
                                className="text-sm text-gray-900 hover:text-blue-600 hover:underline font-medium truncate flex-1 min-w-0"
                                title={t.title}
                              >
                                {t.title}
                              </a>
                              {t.projects && (
                                <span className="text-xs text-muted-foreground truncate max-w-[160px] shrink-0">
                                  {t.projects.name}
                                </span>
                              )}
                              <PriorityPill priority={t.priority as TaskPriority} readOnly />
                              {t.due_date && (
                                <span
                                  className={`text-xs shrink-0 ${
                                    isOverdue
                                      ? "text-red-600 font-medium"
                                      : "text-muted-foreground"
                                  }`}
                                >
                                  {t.due_date}
                                </span>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}

                {/* Only-projects member: note that there are no open tasks */}
                {openTasks.length === 0 && (
                  <div className="px-4 py-2">
                    <p className="text-xs text-muted-foreground italic">No open tasks.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

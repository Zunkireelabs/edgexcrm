/**
 * Pure due-date bucketing for the Home task surfaces (Overview's TasksCard and
 * the Tasks tab). Takes tenant-local "today"/"tomorrow" as plain YYYY-MM-DD
 * strings — no Date object round-trips — so callers must resolve those via
 * `todayInTz`/`addDays` from `@/lib/hr/dates` first. This is what keeps a task
 * due "today" in the tenant's timezone from reading "Overdue" just because the
 * browser or server process is in a different timezone.
 */

export interface DueGroupable {
  due_date: string | null;
}

export interface TaskDueGroups<T> {
  overdue: T[];
  dueToday: T[];
  dueTomorrow: T[];
  later: T[];
}

export function groupTasksByDue<T extends DueGroupable>(
  tasks: readonly T[],
  todayISO: string,
  tomorrowISO: string,
): TaskDueGroups<T> {
  const overdue: T[] = [];
  const dueToday: T[] = [];
  const dueTomorrow: T[] = [];
  const later: T[] = [];

  for (const t of tasks) {
    if (!t.due_date) {
      later.push(t);
    } else if (t.due_date < todayISO) {
      overdue.push(t);
    } else if (t.due_date === todayISO) {
      dueToday.push(t);
    } else if (t.due_date === tomorrowISO) {
      dueTomorrow.push(t);
    } else {
      later.push(t);
    }
  }

  return { overdue, dueToday, dueTomorrow, later };
}

export interface OpenTasksSummary<T> {
  /** The first `max` tasks, soonest due date first, null due dates last. */
  visible: T[];
  /** True count of ALL open tasks, not just `visible.length` — feeds "View all N". */
  total: number;
}

/**
 * Caps + orders open tasks for a summary surface (Home Overview's TasksCard
 * — see docs/IT-AGENCY-PHASE5-DELIVERY-NAV-IA-BRIEF.md §Phase 2). Reuses
 * groupTasksByDue's bucketing rather than re-sorting by hand: concatenating
 * overdue → dueToday → dueTomorrow → later already yields soonest-first with
 * null due dates trailing in `later`.
 */
export function summarizeOpenTasks<T extends DueGroupable>(
  tasks: readonly T[],
  todayISO: string,
  tomorrowISO: string,
  max = 5,
): OpenTasksSummary<T> {
  const { overdue, dueToday, dueTomorrow, later } = groupTasksByDue(tasks, todayISO, tomorrowISO);
  // `later` mixes dated (due after tomorrow) and dateless tasks in input
  // order — split it so a null due_date never sorts ahead of a dated one.
  const laterDated = later.filter((t) => t.due_date != null);
  const laterDateless = later.filter((t) => t.due_date == null);
  const ordered = [...overdue, ...dueToday, ...dueTomorrow, ...laterDated, ...laterDateless];
  return { visible: ordered.slice(0, max), total: tasks.length };
}

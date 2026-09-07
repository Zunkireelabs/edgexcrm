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

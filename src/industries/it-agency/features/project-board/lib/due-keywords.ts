import { addDays } from "@/lib/hr/dates";

export interface DueDateRange {
  from?: string;    // YYYY-MM-DD inclusive lower bound
  to?: string;      // YYYY-MM-DD inclusive upper bound
  isNull?: boolean; // true → due_date IS NULL
}

/**
 * Maps a due-date keyword to a date range for PostgREST filtering.
 * `todayISO` must be the tenant-local "YYYY-MM-DD" (see todayInTz in @/lib/hr/dates) —
 * pure calendar-string math, no Date/toISOString round-trips, so no UTC+ off-by-one.
 * 'overdue'   → { to: yesterday }  (caller also adds IS NOT NULL check)
 * 'today'     → { from: today, to: today }
 * 'this_week' → { from: today, to: today+7 }
 * 'none'      → { isNull: true }
 * other/empty → null (no filter)
 */
export function dueFilterToDateRange(keyword: string | undefined, todayISO: string): DueDateRange | null {
  if (!keyword || keyword === "__all__") return null;

  switch (keyword) {
    case "overdue":
      return { to: addDays(todayISO, -1) };
    case "today":
      return { from: todayISO, to: todayISO };
    case "this_week":
      return { from: todayISO, to: addDays(todayISO, 7) };
    case "none":
      return { isNull: true };
    default:
      return null;
  }
}

export interface DueDateRange {
  from?: string;    // YYYY-MM-DD inclusive lower bound
  to?: string;      // YYYY-MM-DD inclusive upper bound
  isNull?: boolean; // true → due_date IS NULL
}

function toISODate(d: Date): string {
  return d.toISOString().split("T")[0];
}

/**
 * Maps a due-date keyword to a date range for PostgREST filtering.
 * 'overdue'   → { to: yesterday }  (caller also adds IS NOT NULL check)
 * 'today'     → { from: today, to: today }
 * 'this_week' → { from: today, to: today+7 }
 * 'none'      → { isNull: true }
 * other/empty → null (no filter)
 */
export function dueFilterToDateRange(keyword: string | undefined): DueDateRange | null {
  if (!keyword || keyword === "__all__") return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = toISODate(today);

  switch (keyword) {
    case "overdue": {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return { to: toISODate(yesterday) };
    }
    case "today":
      return { from: todayStr, to: todayStr };
    case "this_week": {
      const nextWeek = new Date(today);
      nextWeek.setDate(nextWeek.getDate() + 7);
      return { from: todayStr, to: toISODate(nextWeek) };
    }
    case "none":
      return { isNull: true };
    default:
      return null;
  }
}

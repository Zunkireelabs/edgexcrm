/**
 * Server-side tenant-locale date helpers for leave day-counting.
 * All leave math runs in the tenant's timezone against the tenant's
 * configured weekend days — never the server's local tz.
 */

export function todayInTz(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** `dateISO` is a plain `YYYY-MM-DD` (tz-less) calendar day — day-of-week is computed from the ISO string directly, no tz conversion needed. */
export function dayOfWeek(dateISO: string): number {
  return new Date(`${dateISO}T00:00:00Z`).getUTCDay();
}

export function isWorkingDay(
  dateISO: string,
  weekendDays: number[],
  holidaySet: Set<string>,
): boolean {
  if (weekendDays.includes(dayOfWeek(dateISO))) return false;
  if (holidaySet.has(dateISO)) return false;
  return true;
}

export function addDays(dateISO: string, n: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export interface CountLeaveDaysOptions {
  weekendDays: number[];
  holidays: Set<string>;
  startHalf?: boolean;
  endHalf?: boolean;
}

/**
 * Inclusive day count from startISO to endISO, excluding weekend + holiday
 * days, minus 0.5 for each half-day flag — but only when that boundary day
 * is itself a working day (a half-day flag on a weekend/holiday is a no-op,
 * since that day already contributes 0).
 */
export function countLeaveDays(
  startISO: string,
  endISO: string,
  { weekendDays, holidays, startHalf, endHalf }: CountLeaveDaysOptions,
): number {
  if (endISO < startISO) return 0;

  let total = 0;
  let cursor = startISO;
  while (cursor <= endISO) {
    if (isWorkingDay(cursor, weekendDays, holidays)) {
      let dayValue = 1;
      if (startHalf && cursor === startISO) dayValue -= 0.5;
      if (endHalf && cursor === endISO) dayValue -= 0.5;
      total += Math.max(dayValue, 0);
    }
    cursor = addDays(cursor, 1);
  }
  return total;
}

export function workingDaysPerWeek(weekendDays: number[]): number {
  return 7 - weekendDays.length;
}

/**
 * TS twin of the working-clock rule in `education_process_metrics()` (migration 287, the `wstart` column of the `fc` CTE), kept so the
 * rule is documented and testable. A lead's clock starts at `createdAt` when that falls inside office hours (tenant timezone), else at
 * the next 09:00: the same day if it arrived before 09:00, the next day if it arrived at/after 18:00. EVERY day counts (no weekend rule
 * yet). "Contacted within 1 working hour" = first contact <= clock start + 60 minutes.
 */
export const OFFICE_START_HOUR = 9;
export const OFFICE_END_HOUR = 18;

interface LocalParts {
  y: number;
  m: number;
  d: number;
  h: number;
}

function localParts(at: Date, tz: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour") };
}

/** UTC offset of `tz` at an instant, in ms (local minus UTC). */
function offsetMs(at: Date, tz: string): number {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant at which the wall clock in `tz` reads y-m-d hour:00. */
function localToUtc(y: number, m: number, d: number, hour: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, hour);
  const first = guess - offsetMs(new Date(guess), tz);
  return new Date(guess - offsetMs(new Date(first), tz));
}

export function workingClockStart(createdAt: Date, tz: string, start = OFFICE_START_HOUR, end = OFFICE_END_HOUR): Date {
  const { y, m, d, h } = localParts(createdAt, tz);
  if (h >= start && h < end) return createdAt;
  // Date.UTC normalises day overflow, so d + 1 on a month end rolls over correctly.
  const day = h < start ? d : d + 1;
  const next = new Date(Date.UTC(y, m - 1, day));
  return localToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), start, tz);
}

export const withinOneWorkingHour = (createdAt: Date, firstContactAt: Date | null, tz: string): boolean =>
  firstContactAt !== null && firstContactAt.getTime() <= workingClockStart(createdAt, tz).getTime() + 60 * 60_000;

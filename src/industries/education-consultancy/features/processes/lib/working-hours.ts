/**
 * TS twin of the office-hours clock in migration 288 (`education_working_deadline_oh`, `education_office_hours`). ONE definition:
 * the SQL and this file give the same answers, and `working-hours.fixtures.ts` is the shared table the parity test runs through TS
 * (and the lead runs through SQL on a real database).
 *
 * Office hours = which weekdays are working days (0 = Sunday … 6 = Saturday) and a start/end in minutes after midnight, in the
 * TENANT's timezone. The working clock for a lead starts at its arrival if that falls inside office hours on a working day
 * (start <= time < end), else at the next opening. A deadline adds working minutes to that start, rolling over closing time into the
 * next working day. Arithmetic is on the tenant's WALL clock (as `timestamp AT TIME ZONE` is in Postgres), so a UTC-offset change
 * inside a span shifts the answer by the offset change, the same way in both.
 */
export const OFFICE_START_HOUR = 9;
export const OFFICE_END_HOUR = 18;

export type OfficeHoursSource = "saved" | "learned" | "default";
export interface OfficeHours {
  /** 0 = Sunday … 6 = Saturday. Non-empty, sorted, unique. */
  days: number[];
  startMin: number;
  endMin: number;
  source: OfficeHoursSource;
}

/** What runs when nothing is saved and there is too little data to learn from: every day, 9–18 (today's behaviour). */
export const DEFAULT_OFFICE_HOURS: OfficeHours = { days: [0, 1, 2, 3, 4, 5, 6], startMin: OFFICE_START_HOUR * 60, endMin: OFFICE_END_HOUR * 60, source: "default" };

const MIN = 60_000;
const DAY = 86_400_000;

/** UTC offset of `tz` at an instant, in ms (local minus UTC). */
function offsetMs(at: Date, tz: string): number {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - Math.floor(at.getTime() / 1000) * 1000;
}

/** The wall clock of `at` in `tz`, expressed as a UTC-based "naive" millisecond count. */
const toNaive = (at: Date, tz: string): number => at.getTime() + offsetMs(at, tz);

/** The instant at which the wall clock in `tz` reads the naive time (two passes so a day with a clock change resolves). */
function fromNaive(naive: number, tz: string): Date {
  const first = naive - offsetMs(new Date(naive), tz);
  return new Date(naive - offsetMs(new Date(first), tz));
}

const startOfDay = (naive: number): number => Math.floor(naive / DAY) * DAY;
const weekday = (naive: number): number => new Date(naive).getUTCDay();
const isWorking = (oh: Pick<OfficeHours, "days">, naive: number): boolean => oh.days.includes(weekday(naive));

/** Is this instant inside office hours (a working day, start <= time < end)? */
export function isInOfficeHours(at: Date, oh: OfficeHours, tz: string): boolean {
  const n = toNaive(at, tz);
  const mins = (n - startOfDay(n)) / MIN;
  return isWorking(oh, n) && mins >= oh.startMin && mins < oh.endMin;
}

/**
 * `at` plus `minutes` of working time. With 0 minutes this is the working-clock START (at itself when inside office hours, else the
 * next opening). Same answers as `education_working_deadline_oh()`.
 */
export function workingDeadline(at: Date, minutes: number, oh: OfficeHours, tz: string): Date {
  if (oh.days.length === 0) return new Date(at.getTime() + minutes * MIN);
  let cur = toNaive(at, tz);
  let rem = minutes * MIN;
  for (let i = 0; i < 400; i++) {
    const day = startOfDay(cur);
    const mins = (cur - day) / MIN;
    const working = isWorking(oh, cur);
    if (working && mins >= oh.startMin && mins < oh.endMin) {
      const avail = (oh.endMin - mins) * MIN;
      if (rem <= avail) return fromNaive(cur + rem, tz);
      rem -= avail;
      cur = day + DAY;
    } else if (working && mins < oh.startMin) {
      cur = day + oh.startMin * MIN;
    } else {
      cur = day + DAY;
    }
  }
  return new Date(at.getTime() + minutes * MIN);
}

/** Working minutes between two instants (0 when `to` is not after `from`). The inverse of `workingDeadline` for in-hours spans. */
export function workingMinutesBetween(from: Date, to: Date, oh: OfficeHours, tz: string): number {
  if (to.getTime() <= from.getTime() || oh.days.length === 0) return Math.max(0, (to.getTime() - from.getTime()) / MIN);
  const a = toNaive(from, tz);
  const b = toNaive(to, tz);
  let total = 0;
  for (let day = startOfDay(a); day <= b && day - startOfDay(a) <= 400 * DAY; day += DAY) {
    if (!isWorking(oh, day)) continue;
    const lo = Math.max(a, day + oh.startMin * MIN);
    const hi = Math.min(b, day + oh.endMin * MIN);
    if (hi > lo) total += hi - lo;
  }
  return total / MIN;
}

/** The working-clock start for a lead that arrived at `createdAt`. */
export const workingClockStart = (createdAt: Date, tz: string, oh: OfficeHours = DEFAULT_OFFICE_HOURS): Date => workingDeadline(createdAt, 0, oh, tz);

export const withinOneWorkingHour = (createdAt: Date, firstContactAt: Date | null, tz: string, oh: OfficeHours = DEFAULT_OFFICE_HOURS): boolean =>
  firstContactAt !== null && firstContactAt.getTime() <= workingDeadline(createdAt, 60, oh, tz).getTime();

// ---- display + validation --------------------------------------------------------------------------------------------------------

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const DAY_NAMES_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** "Sun–Fri" for a run of days, "Mon, Wed, Fri" otherwise, "every day" for all seven. */
export function describeDays(days: number[]): string {
  const d = [...new Set(days)].sort((a, b) => a - b);
  if (d.length === 7) return "every day";
  if (d.length === 0) return "no days";
  if (d.length > 2 && d[d.length - 1] - d[0] === d.length - 1) return `${DAY_NAMES[d[0]]}–${DAY_NAMES[d[d.length - 1]]}`;
  return d.map((x) => DAY_NAMES[x]).join(", ");
}

/** 540 -> "9", 570 -> "9:30", 1080 -> "6" (12-hour clock, no am/pm: it reads "9–6"). */
export function describeClock(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}` : `${h12}:${String(m).padStart(2, "0")}`;
}

/** "Sun–Fri, 9–6". */
export const describeOfficeHours = (oh: Pick<OfficeHours, "days" | "startMin" | "endMin">): string => `${describeDays(oh.days)}, ${describeClock(oh.startMin)}–${describeClock(oh.endMin)}`;

/** Read the JSON the SQL returns ({days, start_min, end_min, source}); anything off -> the default (never throws). */
export function parseOfficeHours(raw: unknown): OfficeHours {
  const r = (raw ?? {}) as Record<string, unknown>;
  const days = Array.isArray(r.days) ? [...new Set(r.days.filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))].sort((a, b) => a - b) : [];
  const start = r.start_min;
  const end = r.end_min;
  if (days.length === 0 || typeof start !== "number" || typeof end !== "number" || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 1440 || start >= end) return DEFAULT_OFFICE_HOURS;
  return { days, startMin: start, endMin: end, source: r.source === "saved" ? "saved" : "learned" };
}

export type OfficeHoursInput = { days: number[]; startMin: number; endMin: number };

/** Validate a PUT body `{days, startMin, endMin}`. Field errors keyed like the other settings routes. */
export function validateOfficeHoursInput(body: unknown): { ok: true; value: OfficeHoursInput } | { ok: false; errors: Record<string, string[]> } {
  const b = (body ?? {}) as Record<string, unknown>;
  const errors: Record<string, string[]> = {};
  const days = b.days;
  if (!Array.isArray(days) || days.length === 0 || days.some((d) => !Number.isInteger(d) || (d as number) < 0 || (d as number) > 6)) errors.days = ["Pick at least one day (0 = Sunday … 6 = Saturday)"];
  const mins = (v: unknown) => typeof v === "number" && Number.isInteger(v);
  if (!mins(b.startMin) || (b.startMin as number) < 0 || (b.startMin as number) >= 1440) errors.startMin = ["Must be whole minutes after midnight, before 24:00"];
  if (!mins(b.endMin) || (b.endMin as number) <= 0 || (b.endMin as number) > 1440) errors.endMin = ["Must be whole minutes after midnight, at most 24:00"];
  if (!errors.startMin && !errors.endMin && (b.startMin as number) >= (b.endMin as number)) errors.endMin = ["Closing time must be after opening time"];
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { days: [...new Set(days as number[])].sort((a, c) => a - c), startMin: b.startMin as number, endMin: b.endMin as number } };
}

// ---- learning (TS twin of education_office_hours' learned branch) -----------------------------------------------------------------

/** A weekday is "working" when it has at least this share of the busiest weekday's calls/meetings/notes. */
export const LEARN_DAY_SHARE = 0.1;
/** Fewer events than this in 90 days and nothing is learned: every day, 9–18. */
export const LEARN_MIN_EVENTS = 200;
export const LEARN_DAYS = 90;

/** `byWeekday` is 7 counts, Sunday first. Start and end stay 9:00–18:00 when learned; the hour counts are shown as evidence only. */
export function learnOfficeHours(byWeekday: number[]): OfficeHours {
  const total = byWeekday.reduce((a, b) => a + b, 0);
  if (total < LEARN_MIN_EVENTS) return DEFAULT_OFFICE_HOURS;
  const max = Math.max(...byWeekday);
  const days = byWeekday.map((n, i) => (n >= LEARN_DAY_SHARE * max ? i : -1)).filter((i) => i >= 0);
  return { days, startMin: OFFICE_START_HOUR * 60, endMin: OFFICE_END_HOUR * 60, source: "learned" };
}

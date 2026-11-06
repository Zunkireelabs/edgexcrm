import { dayBoundsInTz } from "@/lib/filters/compile";

/**
 * Pulse windows are half-open [from, to) and computed in the TENANT timezone.
 *  - today: from local midnight (tenant tz) to now. "24h" is accepted as an alias of "today" (one release).
 *  - 7d / 30d: from local midnight of (today - (n-1)) to now
 *  - custom: whole local days, [midnight(from), midnight(to + 1 day))
 * "Previous" is the equal-length window immediately before; "usual" is the 4 equal-length windows before the
 * current one (mean per person per metric). Lengths are measured in ms so previous/usual are always the same
 * size as the (possibly partial-day) current window — comparing a half-finished day to full days would make
 * every rule fire in the morning.
 */
export type PulseWindowKey = "today" | "7d" | "30d" | "custom";
export const PULSE_WINDOW_KEYS: PulseWindowKey[] = ["today", "7d", "30d", "custom"];
/** Keys the API accepts: the real ones plus the retired "24h" (an alias of "today"). */
const ACCEPTED_KEYS = [...PULSE_WINDOW_KEYS, "24h"];
export const USUAL_WINDOW_COUNT = 4;

export interface PulseWindow {
  key: PulseWindowKey;
  from: Date;
  to: Date;
}

export function isPulseWindowKey(v: string): v is PulseWindowKey {
  return ACCEPTED_KEYS.includes(v);
}

function localDateStr(d: Date, tz: string): string {
  return d.toLocaleString("sv-SE", { timeZone: tz }).slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function resolvePulseWindow(
  key: string,
  now: Date,
  tz: string,
  custom?: { from?: string | null; to?: string | null },
): PulseWindow | null {
  if (!isPulseWindowKey(key)) return null;
  if (key === "today" || (key as string) === "24h") {
    // Since 00:00 in the TENANT timezone. A floor of one minute keeps a window opened at exactly midnight non-empty.
    const from = new Date(dayBoundsInTz(localDateStr(now, tz), tz).start);
    return { key: "today", from, to: new Date(Math.max(now.getTime(), from.getTime() + 60_000)) };
  }
  if (key === "7d" || key === "30d") {
    const n = key === "7d" ? 7 : 30;
    const startDay = addDays(localDateStr(now, tz), -(n - 1));
    return { key, from: new Date(dayBoundsInTz(startDay, tz).start), to: now };
  }
  if (!custom?.from || !custom?.to || !DATE_RE.test(custom.from) || !DATE_RE.test(custom.to)) return null;
  const from = new Date(dayBoundsInTz(custom.from, tz).start);
  const to = new Date(dayBoundsInTz(custom.to, tz).end);
  if (from.getTime() >= to.getTime()) return null;
  return { key, from, to };
}

export function windowLengthMs(w: { from: Date; to: Date }): number {
  return w.to.getTime() - w.from.getTime();
}

/** The equal-length window immediately before `w`. */
export function previousWindow(w: PulseWindow): PulseWindow {
  const len = windowLengthMs(w);
  return { key: w.key, from: new Date(w.from.getTime() - len), to: w.from };
}

/** The `count` equal-length windows before `w`, most recent first (index 0 == previousWindow). */
export function usualWindows(w: PulseWindow, count = USUAL_WINDOW_COUNT): PulseWindow[] {
  const len = windowLengthMs(w);
  return Array.from({ length: count }, (_, i) => ({
    key: w.key,
    from: new Date(w.from.getTime() - len * (i + 1)),
    to: new Date(w.from.getTime() - len * i),
  }));
}

/** The whole span the single RPC call has to cover: oldest usual window start → current window end. */
export function fullSpan(w: PulseWindow, count = USUAL_WINDOW_COUNT): { from: Date; to: Date } {
  return { from: new Date(w.from.getTime() - windowLengthMs(w) * count), to: w.to };
}

export function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

export interface PeriodSpan { from: Date; to: Date }
export interface PeriodSpans {
  /** The comparison period ("last week", "yesterday by this time"). */
  previous: PeriodSpan;
  /** The 4 spans "usual" is the mean of, most recent first. For rolling windows these include `previous`. */
  usual: PeriodSpan[];
  /** true for Today: previous = yesterday over the same elapsed clock span, usual = the same span on the previous 4 same weekdays. */
  aligned: boolean;
}

/**
 * The periods a window is compared with. Rolling windows (7d / 30d / custom) compare with the equal-length windows
 * before them. TODAY compares like with like: yesterday from 00:00 to the same elapsed time, and the same elapsed
 * span on the previous 4 same weekdays (a Monday against Mondays, not a quiet Sunday). Spans are cut in the tenant
 * timezone, from local midnights; the span length is the elapsed ms (so a DST-change day is off by at most an hour).
 */
export function periodSpans(w: PulseWindow, tz: string): PeriodSpans {
  if (w.key !== "today") {
    return { previous: previousWindow(w), usual: usualWindows(w), aligned: false };
  }
  const elapsed = windowLengthMs(w);
  const today = localDateStr(w.from, tz);
  const span = (daysBack: number): PeriodSpan => {
    const from = new Date(dayBoundsInTz(addDays(today, -daysBack), tz).start);
    return { from, to: new Date(from.getTime() + elapsed) };
  };
  return { previous: span(1), usual: [7, 14, 21, 28].map(span), aligned: true };
}

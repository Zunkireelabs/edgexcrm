import { dayBoundsInTz } from "@/lib/filters/compile";

/**
 * Pulse windows are half-open [from, to) and computed in the TENANT timezone.
 *  - 24h: rolling, [now-24h, now)
 *  - 7d / 30d: from local midnight of (today - (n-1)) to now
 *  - custom: whole local days, [midnight(from), midnight(to + 1 day))
 * "Previous" is the equal-length window immediately before; "usual" is the 4 equal-length windows before the
 * current one (mean per person per metric). Lengths are measured in ms so previous/usual are always the same
 * size as the (possibly partial-day) current window — comparing a half-finished day to full days would make
 * every rule fire in the morning.
 */
export type PulseWindowKey = "24h" | "7d" | "30d" | "custom";
export const PULSE_WINDOW_KEYS: PulseWindowKey[] = ["24h", "7d", "30d", "custom"];
export const USUAL_WINDOW_COUNT = 4;

export interface PulseWindow {
  key: PulseWindowKey;
  from: Date;
  to: Date;
}

export function isPulseWindowKey(v: string): v is PulseWindowKey {
  return (PULSE_WINDOW_KEYS as string[]).includes(v);
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
  if (key === "24h") return { key, from: new Date(now.getTime() - 24 * 3600_000), to: now };
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

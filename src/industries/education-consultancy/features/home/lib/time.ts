import { dayBoundsInTz } from "@/lib/filters/compile";

/** Calendar date (YYYY-MM-DD) of an instant in the tenant timezone. */
export function localDate(d: Date, tz: string): string {
  return d.toLocaleString("sv-SE", { timeZone: tz }).slice(0, 10);
}

/**
 * Whole calendar days from `from`'s local date to `to`'s local date in `tz` ("arrived 28 Oct, now 8 Nov" = 11), at least 1, as "1 day" / "11 days".
 * For waits of a working day or more, where office minutes would understate how long someone has really waited.
 */
export function calendarDaysLabel(from: Date, to: Date, tz: string): string {
  const diff = Math.round((Date.parse(`${localDate(to, tz)}T00:00:00Z`) - Date.parse(`${localDate(from, tz)}T00:00:00Z`)) / 86_400_000);
  const n = Math.max(1, diff);
  return `${n} ${n === 1 ? "day" : "days"}`;
}

export function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole calendar days from `a` to `b` (b - a), both YYYY-MM-DD. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** [start, end) of the tenant-local day containing `d`. */
export function dayBounds(d: Date, tz: string): { start: Date; end: Date } {
  const b = dayBoundsInTz(localDate(d, tz), tz);
  return { start: new Date(b.start), end: new Date(b.end) };
}

export function localHour(d: Date, tz: string): number {
  return Number(d.toLocaleString("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).slice(0, 2)) % 24;
}

export function partOfDay(d: Date, tz: string): "morning" | "afternoon" | "evening" {
  const h = localHour(d, tz);
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

export function clockLabel(d: Date, tz: string): string {
  return d.toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
}

/** The ONE time format on Home: "9:08 pm", in the tenant timezone. */
export function clock12(d: Date, tz: string): string {
  return d
    .toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/\s*(AM|PM)$/i, (_m, ap: string) => ` ${ap.toLowerCase()}`);
}

/** UTC offset (ms) of `tz` at the instant `t`: local wall clock minus UTC. */
function tzOffsetMs(t: number, tz: string): number {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(t))
    .reduce<Record<string, number>>((a, x) => (x.type === "literal" ? a : { ...a, [x.type]: Number(x.value) }), {});
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(t / 1000) * 1000;
}

/**
 * A `datetime-local` value ("2026-11-11T09:08") is a wall-clock time with NO zone, and `new Date(value)` reads it in
 * the BROWSER's zone. Home books call-backs in the TENANT's zone, so convert here: the instant whose wall clock in
 * `tz` is `value`. Null for anything that isn't a valid local date-time.
 */
export function tenantLocalToIso(value: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let t = wall - tzOffsetMs(wall, tz);
  t = wall - tzOffsetMs(t, tz); // re-evaluate at the candidate (DST edges)
  return new Date(t).toISOString();
}

export function weekdayShort(d: Date, tz: string): string {
  return d.toLocaleDateString("en-US", { timeZone: tz, weekday: "short" });
}

/** "38 min", "2 h", "3 days": a compact age. */
export function ageLabel(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h`;
  const days = Math.floor(h / 24);
  return days === 1 ? "1 day" : `${days} days`;
}

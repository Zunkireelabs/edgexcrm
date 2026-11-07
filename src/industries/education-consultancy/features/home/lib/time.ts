import { dayBoundsInTz } from "@/lib/filters/compile";

/** Calendar date (YYYY-MM-DD) of an instant in the tenant timezone. */
export function localDate(d: Date, tz: string): string {
  return d.toLocaleString("sv-SE", { timeZone: tz }).slice(0, 10);
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

export function clock12(d: Date, tz: string): string {
  return d.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).replace(" AM", " am").replace(" PM", " pm");
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

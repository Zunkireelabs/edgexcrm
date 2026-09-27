import { dayBoundsInTz } from "@/lib/filters/compile";

// Sibling to date-range-presets.ts, which is lower-bound-only (no "yesterday",
// no upper bound). This resolver produces a full {from, to} window — the first
// place in the app that needs one. Kept separate rather than reshaping
// date-range-presets.ts, which 3 other surfaces (dashboard/pipeline/leads-facet)
// depend on today.

export const DATE_WINDOW_PRESETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "this-week", label: "This week" },
  { key: "custom", label: "Custom range" },
] as const;

export type DateWindowKey = (typeof DATE_WINDOW_PRESETS)[number]["key"];

const WINDOW_KEYS = new Set<string>(DATE_WINDOW_PRESETS.map((p) => p.key));

export function isDateWindowKey(value: string): value is DateWindowKey {
  return WINDOW_KEYS.has(value);
}

export interface DateWindow {
  from: Date;
  to: Date;
}

function localDateStr(d: Date, tz: string): string {
  return d.toLocaleString("sv-SE", { timeZone: tz }).slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Monday-start week, matching ISO week convention used elsewhere in the app.
function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 = Sunday
  const diff = dow === 0 ? -6 : 1 - dow;
  return addDays(dateStr, diff);
}

/**
 * Resolves a window key into {from, to} Date objects. `custom` requires
 * explicit from/to (validated from <= to by the caller) and is passed through
 * this function's `custom` param rather than being derivable from `now`.
 */
export function resolveDateWindow(
  key: string,
  now: Date,
  tz: string,
  custom?: { from: string; to: string },
): DateWindow | null {
  if (!isDateWindowKey(key)) return null;

  if (key === "custom") {
    if (!custom) return null;
    const from = new Date(dayBoundsInTz(custom.from, tz).start);
    const to = new Date(dayBoundsInTz(custom.to, tz).end);
    if (from.getTime() > to.getTime()) return null;
    return { from, to };
  }

  const today = localDateStr(now, tz);

  if (key === "today") {
    const bounds = dayBoundsInTz(today, tz);
    return { from: new Date(bounds.start), to: new Date(bounds.end) };
  }

  if (key === "yesterday") {
    const y = addDays(today, -1);
    const bounds = dayBoundsInTz(y, tz);
    return { from: new Date(bounds.start), to: new Date(bounds.end) };
  }

  // this-week
  const monday = mondayOf(today);
  const from = new Date(dayBoundsInTz(monday, tz).start);
  const to = new Date(dayBoundsInTz(today, tz).end);
  return { from, to };
}

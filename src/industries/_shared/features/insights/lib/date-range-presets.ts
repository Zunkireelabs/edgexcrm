import { dayBoundsInTz } from "@/lib/filters/compile";

export const DATE_RANGE_PRESETS = [
  { key: "all", label: "All time" },
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "month", label: "This month" },
] as const;

export type DateRangePresetKey = (typeof DATE_RANGE_PRESETS)[number]["key"];

const PRESET_KEYS = new Set<string>(DATE_RANGE_PRESETS.map((p) => p.key));

export function isDateRangePresetKey(value: string): value is DateRangePresetKey {
  return PRESET_KEYS.has(value);
}

/**
 * Resolves a preset key to a `created_at >= ...` lower bound, or `null` for "all
 * time" / an unrecognized key. No upper bound exists yet — see AggregateScope.createdAfter.
 *
 * Day-boundary presets ("today", "month") are snapped in the tenant's timezone,
 * not the server's: the returned instant is that local calendar day's midnight
 * expressed in UTC, via the DST-correct `dayBoundsInTz` helper the filters
 * engine already owns. "7d"/"30d" are rolling offsets from `now` with no
 * day-boundary snapping, so `tz` does not affect them.
 */
export function resolveDateRangeFrom(
  key: string | undefined,
  now: Date,
  tz: string,
): Date | null {
  if (!key || !isDateRangePresetKey(key) || key === "all") return null;

  switch (key) {
    case "today": {
      const today = now.toLocaleString("sv-SE", { timeZone: tz }).slice(0, 10);
      return new Date(dayBoundsInTz(today, tz).start);
    }
    case "month": {
      const monthStart = now.toLocaleString("sv-SE", { timeZone: tz }).slice(0, 8) + "01";
      return new Date(dayBoundsInTz(monthStart, tz).start);
    }
    case "7d": {
      const from = new Date(now);
      from.setDate(from.getDate() - 7);
      return from;
    }
    case "30d": {
      const from = new Date(now);
      from.setDate(from.getDate() - 30);
      return from;
    }
    default:
      return null;
  }
}

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
 */
export function resolveDateRangeFrom(key: string | undefined, now: Date): Date | null {
  if (!key || !isDateRangePresetKey(key) || key === "all") return null;

  const from = new Date(now);
  switch (key) {
    case "today":
      from.setHours(0, 0, 0, 0);
      return from;
    case "7d":
      from.setDate(from.getDate() - 7);
      return from;
    case "30d":
      from.setDate(from.getDate() - 30);
      return from;
    case "month":
      from.setDate(1);
      from.setHours(0, 0, 0, 0);
      return from;
    default:
      return null;
  }
}

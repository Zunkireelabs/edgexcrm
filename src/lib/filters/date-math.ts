// Shared calendar arithmetic for relative-date filters (within_last/within_next)
// and their facet-count counterpart (tree-to-aggregate-params.ts). Both MUST
// compute the identical instant for the same (now, amount, unit) — before this
// module existed, compile.ts did the math in UTC while tree-to-aggregate-params.ts
// did it in the server process's local timezone, so a month/year-unit filter's
// facet-count badge could silently disagree with the actual filtered results.
//
// UTC-based (not ctx.tz-aware) — matches compile.ts's existing within_last/
// within_next contract, which anchors to ctx.now via UTC calendar fields. This
// is deliberately different from "on"/"date_between", which resolve a LOCAL
// calendar day via dayBoundsInTz (compile.ts) — within_last/within_next mean
// "N calendar units back from this instant," not "on this local day."

export type RelativeUnit = "d" | "m" | "y";

const RELATIVE_VALUE_RE = /^(\d+)([dmy])$/;

export function parseRelativeValue(value: string): { amount: number; unit: RelativeUnit } | null {
  const match = RELATIVE_VALUE_RE.exec(value);
  if (!match) return null;
  return { amount: Number(match[1]), unit: match[2] as RelativeUnit };
}

// Adds `amount` calendar units (may be negative) to `base` in UTC. For "d" this
// is plain day arithmetic. For "m"/"y" this clamps the day-of-month to the
// target month's last valid day instead of overflowing into the following
// month — the classic "Jan 31 + 1 month" trap: a raw `setUTCMonth(current + 1)`
// on Jan 31 rolls into March (Feb has no 31st), silently shrinking or growing
// the window. `Date.UTC(year, month + 1, 0)` is always the last day of `month`
// regardless of how far `month` is out of the normal 0-11 range, which is how
// this stays correct across year boundaries too (year arithmetic is just
// `amount * 12` months — this also makes a leap-day Feb 29 correctly clamp to
// Feb 28 one year later).
export function addCalendarUnitsUTC(base: Date, amount: number, unit: RelativeUnit): Date {
  if (unit === "d") {
    const result = new Date(base.getTime());
    result.setUTCDate(result.getUTCDate() + amount);
    return result;
  }
  const months = unit === "y" ? amount * 12 : amount;
  const targetMonthIndex = base.getUTCMonth() + months;
  const daysInTargetMonth = new Date(Date.UTC(base.getUTCFullYear(), targetMonthIndex + 1, 0)).getUTCDate();
  const day = Math.min(base.getUTCDate(), daysInTargetMonth);
  const result = new Date(base.getTime());
  result.setUTCFullYear(base.getUTCFullYear(), targetMonthIndex, day);
  return result;
}

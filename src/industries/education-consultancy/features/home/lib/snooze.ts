import { dayBounds } from "./time";

/** "Snooze until tomorrow": the item returns at the tenant-local start of the next day. */
export function snoozeUntilTomorrow(now: Date, tz: string): Date {
  return dayBounds(now, tz).end;
}

/** `<kind>:<id>` as built by the rules (e.g. "new_uncalled:<uuid>", "going_quiet:all"). Anything else is rejected. */
export const ITEM_KEY_RE = /^[a-z_]{3,40}:[A-Za-z0-9_-]{1,64}$/;
export const isValidItemKey = (v: unknown): v is string => typeof v === "string" && ITEM_KEY_RE.test(v);

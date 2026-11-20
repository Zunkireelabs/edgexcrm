import { dayBoundsInTz } from "@/lib/filters/compile";
import { addDaysStr, localDate } from "./time";
import { MISSED_MAX_DAYS } from "./rules/callbacks";

/**
 * Call-back reminders older than 14 TENANT-LOCAL days. Instant form of the same test `isStaleCallback` applies per lead:
 * due < local midnight of (today - 14). (Day 14 is "missed", day 15 is stale.)
 */
export function staleCutoff(now: Date, tz: string): Date {
  return new Date(dayBoundsInTz(addDaysStr(localDate(now, tz), -MISSED_MAX_DAYS), tz).start);
}

/** Most leads a single "Clear them" call will touch. */
export const CLEAR_MAX = 1000;
/** The client may be this far (as a share of what it showed) from the server's recount before it must re-confirm. */
export const CLEAR_TOLERANCE = 0.1;

/**
 * The client sends only the count it showed. The server recomputes the set (scope + age) and never trusts ids from the
 * client; if its own count is off by more than 10% of what the person confirmed, the person sees the new number first.
 */
export function clearCountMatches(shown: number, actual: number): boolean {
  if (shown === actual) return true;
  if (shown <= 0) return false;
  return Math.abs(actual - shown) / shown <= CLEAR_TOLERANCE;
}

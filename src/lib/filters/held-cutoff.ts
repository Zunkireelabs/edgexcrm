/**
 * "Held for 48 hours or more" — ONE definition for Home's untouched-held count (`loadUntouchedHeld`) and the leads list's
 * `held_48h` filter, so the number on Home and the rows its Review link opens cannot drift.
 *
 * A lead counts once its holder has had it 48 hours: `assigned_at` older than the cutoff, or null (older leads were never
 * stamped). A lead handed over seconds ago (by "Assign as suggested", say) is not yet "held untouched".
 */
export const HELD_HOURS = 48;

export function heldCutoff(now: Date): Date {
  return new Date(now.getTime() - HELD_HOURS * 3_600_000);
}

/** The two OR-ed PostgREST predicates (the caller joins them with `or`). Timestamps are unquoted ISO, as `.or()` takes them. */
export function heldClauses(cutoff: Date): string[] {
  return ["assigned_at.is.null", `assigned_at.lt.${cutoff.toISOString()}`];
}

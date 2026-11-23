import { dayBoundsInTz } from "./compile";
import { and, pgVal } from "./pgrst";

/**
 * "No contact for 2+ weeks" — ONE definition, used by both the `no_contact_14d` filter (the leads list) and Home's
 * quiet-leads count (`loadQuietOverTwoWeeks`), so the number on Home and the rows its Review link opens cannot drift.
 *
 * The cutoff is the local midnight of (tenant-today - 14), in the tenant's own timezone (never server-local time).
 * "Contact" = `last_touched_at` (moves on calls, emails, meetings and notes). A lead never touched falls back to when it
 * was handed to its holder, then to when it was created.
 */
export const QUIET_CONTACT_DAYS = 14;

/** Calendar date (YYYY-MM-DD) of an instant in `tz`. */
function localDateIn(d: Date, tz: string): string {
  return d.toLocaleString("sv-SE", { timeZone: tz }).slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The instant before which a lead counts as "no contact for 2+ weeks": tenant-local midnight, 14 days before tenant-today. */
export function quietContactCutoff(now: Date, tz: string): Date {
  return new Date(dayBoundsInTz(addDays(localDateIn(now, tz), -QUIET_CONTACT_DAYS), tz).start);
}

/** The three OR-ed PostgREST predicates of the quiet test (the caller joins them with `or`). */
export function quietContactClauses(cutoff: Date): string[] {
  const c = pgVal(cutoff.toISOString());
  return [
    `last_touched_at.lt.${c}`,
    and("last_touched_at.is.null", `assigned_at.lt.${c}`),
    and("last_touched_at.is.null", "assigned_at.is.null", `created_at.lt.${c}`),
  ];
}

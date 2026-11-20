/**
 * "Contact" has ONE definition on Home (and A3's smart assignment must use it too):
 *
 *   a lead was CONTACTED when a call / email / meeting activity (`lead_activities`) OR a human note (`lead_notes`,
 *   `ai_tool_call_id IS NULL`) was logged on it.
 *
 * Why notes count: staff log contact as notes (real Admizz data, 21 days: 913 notes vs 133 call activities).
 *
 * Where it lives:
 *   - `leads.last_touched_at` (migration 250 trigger) already moves on all of the above, so every rule that reads it
 *     (new_uncalled, going_quiet, nudges) treats a note as contact.
 *   - SQL: `education_home_impact()` (migration 284) uses the same union for "contacted within 1 hour" and
 *     "call-backs done".
 *   - TS: `isContactEvent` below, and `week-stats.firstHourCounts` for "Your last 7 days".
 * Change the definition HERE and in migration 284's function together.
 */
export const CONTACT_ACTIVITY_TYPES = ["call", "email", "meeting"] as const;

export function isContactEvent(e: { type: string }): boolean {
  return e.type === "note" || (CONTACT_ACTIVITY_TYPES as readonly string[]).includes(e.type);
}

/** A call that did not connect: no answer, or busy. */
export const UNANSWERED_OUTCOMES = ["no_answer", "busy"] as const;
export const isUnanswered = (e: { type: string; outcome: string | null }) =>
  e.type === "call" && !!e.outcome && (UNANSWERED_OUTCOMES as readonly string[]).includes(e.outcome);

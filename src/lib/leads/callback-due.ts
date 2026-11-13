/** Window for a manually booked call-back (`leads.callback_due_at`). */
export const CALLBACK_MAX_PAST_MS = 5 * 60_000;
export const CALLBACK_MAX_AHEAD_MS = 90 * 86_400_000;

/**
 * Validate a client-supplied `callback_due_at`: an ISO timestamp (stored normalised to UTC ISO) or null (clears it).
 * Rejects unparseable values, more than 5 minutes in the past, and more than 90 days ahead.
 */
export function coerceCallbackDue(
  value: unknown,
  now: Date = new Date(),
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false, error: "callback_due_at must be an ISO date-time or null" };
  }
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return { ok: false, error: "callback_due_at is not a valid date-time" };
  if (t < now.getTime() - CALLBACK_MAX_PAST_MS) {
    return { ok: false, error: "Call-back time can't be in the past" };
  }
  if (t > now.getTime() + CALLBACK_MAX_AHEAD_MS) {
    return { ok: false, error: "Call-back time can't be more than 90 days ahead" };
  }
  return { ok: true, value: new Date(t).toISOString() };
}

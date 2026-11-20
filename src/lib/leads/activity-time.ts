/**
 * "When" of a logged activity (EDGEX-155, Log call): a call can be logged after the fact. The client sends an ISO time;
 * the server stamps `lead_activities.created_at` / `completed_at` with it. Past only (60s of clock skew tolerated),
 * so nothing can be logged into the future. Absent = the table default (now). No schema change: `created_at` is a
 * plain TIMESTAMPTZ with a default, so an explicit value is accepted on insert.
 */
export type ActivityTimeResult = { ok: true; iso: string | null } | { ok: false; error: string };

export function resolveActivityTime(input: unknown, now: Date = new Date()): ActivityTimeResult {
  if (input === undefined || input === null || input === "") return { ok: true, iso: null };
  if (typeof input !== "string") return { ok: false, error: "Must be an ISO date-time" };
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return { ok: false, error: "Must be an ISO date-time" };
  if (d.getTime() > now.getTime() + 60_000) return { ok: false, error: "Can't be in the future" };
  if (d.getUTCFullYear() < 2000) return { ok: false, error: "Too far in the past" };
  return { ok: true, iso: d.toISOString() };
}

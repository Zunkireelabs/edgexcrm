/**
 * TS twin of the owner-wait rule in `education_process_metrics()` (migration 286), kept so the rule is documented and testable.
 * First assignment time = the earliest of `leads.assigned_at` and the first audit row whose `changes` has `assigned_to`.
 * A lead created already assigned (assigned_to set, neither timestamp) counts as assigned at creation: wait 0. A lead never
 * assigned has no wait (null). A negative gap is clamped to 0.
 */
export function ownerWaitMinutes(input: {
  createdAt: string;
  assignedAt: string | null;
  assignedTo: string | null;
  firstAssignAuditAt: string | null;
}): number | null {
  const times = [input.assignedAt, input.firstAssignAuditAt].filter((t): t is string => !!t).map((t) => Date.parse(t));
  if (times.length === 0) return input.assignedTo ? 0 : null;
  return Math.max(0, (Math.min(...times) - Date.parse(input.createdAt)) / 60_000);
}

export const percentile = (sorted: number[], p: number): number | null => {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
};

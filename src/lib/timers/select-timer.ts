/**
 * Picks which running timer the global shell chip surfaces when a user has
 * more than one active at once (allowed — `active_timers` is keyed on
 * (user_id, task_id), not unique per user). `GET /api/v1/timers` already
 * orders by `started_at` ascending, but this sorts defensively rather than
 * assuming the caller preserved that order.
 */

export interface RunningTimerLike {
  id: string;
  started_at: string;
}

export interface TimerSelection<T extends RunningTimerLike> {
  primary: T;
  extraCount: number;
}

export function selectPrimaryTimer<T extends RunningTimerLike>(
  timers: readonly T[],
): TimerSelection<T> | null {
  if (timers.length === 0) return null;
  const sorted = [...timers].sort((a, b) => a.started_at.localeCompare(b.started_at));
  return { primary: sorted[0], extraCount: sorted.length - 1 };
}

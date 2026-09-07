/**
 * Whether a `POST /api/v1/timers/{id}/stop` response means "the timer is no
 * longer running" from the caller's point of view. A 409 `ALREADY_STOPPED`
 * means someone else (the header chip's stop button, another tab/device)
 * already stopped it — that's the same end state as this call succeeding.
 * Treating 409 as a failure is what left a row's stop control stuck
 * rendering "stop" forever after a foreign stop: the button only cleared
 * its running state on `res.ok`, so every further click just re-409'd.
 */
export function isTimerStopped(res: { ok: boolean; status: number }): boolean {
  return res.ok || res.status === 409;
}

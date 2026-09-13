/**
 * The task detail drawer (Round 2 slice A) is opened via router navigation to
 * /tasks/<id> so the @modal intercepting route can render it — which means
 * it lives in a different part of the React tree than the page underneath it
 * (the /tasks table, Home's My Tasks, the cockpit Tasks tab). There is no
 * prop channel from the drawer back to that page, so a plain window
 * `CustomEvent` is the mechanism: the drawer calls notifyTaskChanged() after
 * any successful edit or delete, and any surface showing a task list listens
 * for it to refetch. Mirrors src/lib/timers/timer-events.ts exactly.
 */
export const TASK_CHANGED_EVENT = "edgex:task-changed";

export function notifyTaskChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(TASK_CHANGED_EVENT));
  }
}

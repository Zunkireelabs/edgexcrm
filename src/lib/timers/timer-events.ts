/**
 * A running timer can be started or stopped from more than one place at
 * once — a Home task row (Phase 2b) and the global shell chip (Phase 3) both
 * mutate `active_timers`, and the shell persists across client-side
 * navigation, so it needs to notice a change made somewhere else without a
 * full reload. A plain window `CustomEvent` is the whole mechanism: whoever
 * starts or stops a timer calls `notifyTimersChanged()`, and anything
 * showing timer state (currently just `RunningTimerChip`) listens for it
 * alongside the window `focus` refetch.
 */
export const TIMERS_CHANGED_EVENT = "edgex:timers-changed";

export function notifyTimersChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(TIMERS_CHANGED_EVENT));
  }
}

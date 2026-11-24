"use client";

import { useCallback, useEffect, useRef } from "react";

// Quiet background refresh for the Inbox and the new-chat pop-up.
// Rules: never remount, never show "Loading…", never redraw when nothing changed, never overlap requests,
// pause while the tab is hidden and catch up when it comes back, and back off silently on errors.

/**
 * Merge a fresh server list into what is on screen. Keeps the server's order, reuses the existing object for every row
 * that did not change, and returns `prev` itself when nothing changed at all (so React skips the redraw).
 */
export function mergeById<T extends { id?: unknown }>(prev: T[], next: T[]): T[] {
  const old = new Map<unknown, { row: T; json: string }>();
  for (const row of prev) old.set(row.id, { row, json: JSON.stringify(row) });
  let changed = prev.length !== next.length;
  const merged = next.map((row, i) => {
    const hit = old.get(row.id);
    if (hit && hit.json === JSON.stringify(row)) {
      if (prev[i] !== hit.row) changed = true; // same row, different position
      return hit.row;
    }
    changed = true;
    return row;
  });
  return changed ? merged : prev;
}

/**
 * Runs `task` every `intervalMs` while the tab is visible, plus whenever the tab comes back. `trigger()` runs it now
 * (used after a live event); if a run is already going, exactly one more run follows it. A task that throws is retried
 * later with a growing pause (up to 60 s) and no noise.
 */
export function useQuietPoll(task: () => Promise<void>, intervalMs: number, enabled = true) {
  const taskRef = useRef(task);
  useEffect(() => {
    taskRef.current = task;
  });
  const running = useRef(false);
  const rerun = useRef(false);
  const failures = useRef(0);
  const notBefore = useRef(0);

  const run = useCallback(
    async (force: boolean) => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (running.current) {
        if (force) rerun.current = true;
        return;
      }
      if (!force && Date.now() < notBefore.current) return;
      running.current = true;
      try {
        await taskRef.current();
        failures.current = 0;
        notBefore.current = 0;
      } catch {
        failures.current += 1;
        notBefore.current = Date.now() + Math.min(intervalMs * 2 ** failures.current, 60_000);
      } finally {
        running.current = false;
        if (rerun.current) {
          rerun.current = false;
          void run(true);
        }
      }
    },
    [intervalMs],
  );

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => void run(false), intervalMs);
    const onBack = () => {
      if (document.visibilityState === "visible") void run(true);
    };
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("focus", onBack);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("focus", onBack);
    };
  }, [run, intervalMs, enabled]);

  return useCallback(() => run(true), [run]);
}

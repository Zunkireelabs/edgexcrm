"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import type { ActiveTimer } from "@/types/database";
import type { TimeEntryWithJoins } from "./use-time-entries";

export interface ActiveTimerWithJoins extends ActiveTimer {
  tasks: { id: string; title: string } | null;
  projects: { id: string; name: string; accounts: { id: string; name: string } | null } | null;
}

/** MM:SS under 1h, H:MM:SS under 10h, "Hh Mm" beyond that (a timer left running overnight). */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h >= 10) return `${h}h ${m}m`;
  if (h === 0) return `${m}:${String(s).padStart(2, "0")}`;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

interface UseActiveTimersResult {
  timers: ActiveTimerWithJoins[];
  loading: boolean;
  now: number;
  isTaskRunning: (taskId: string) => ActiveTimerWithJoins | undefined;
  isPending: (taskId: string) => boolean;
  startTimer: (taskId: string) => Promise<void>;
  stopTimer: (timerId: string) => Promise<TimeEntryWithJoins | null>;
  discardTimer: (timerId: string) => Promise<void>;
  refetch: () => Promise<void>;
}

function useActiveTimers(): UseActiveTimersResult {
  const [timers, setTimers] = useState<ActiveTimerWithJoins[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [pendingTaskIds, setPendingTaskIds] = useState<Set<string>>(new Set());

  const fetchTimers = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/timers");
      if (!res.ok) throw new Error("Failed to load active timers");
      const { data } = await res.json();
      setTimers((data ?? []) as ActiveTimerWithJoins[]);
    } catch {
      // Best-effort — the focus/poll refetch below will retry.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTimers();
  }, [fetchTimers]);

  // A timer started in another tab/device should show up here too.
  useEffect(() => {
    function onFocus() {
      fetchTimers();
    }
    window.addEventListener("focus", onFocus);
    const poll = setInterval(fetchTimers, 60000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(poll);
    };
  }, [fetchTimers]);

  // Live ticking clock — only runs while at least one timer is active.
  useEffect(() => {
    if (timers.length === 0) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [timers.length]);

  function setPending(taskId: string, pending: boolean) {
    setPendingTaskIds((prev) => {
      const next = new Set(prev);
      if (pending) next.add(taskId);
      else next.delete(taskId);
      return next;
    });
  }

  const isTaskRunning = useCallback(
    (taskId: string) => timers.find((t) => t.task_id === taskId),
    [timers]
  );

  const isPending = useCallback((taskId: string) => pendingTaskIds.has(taskId), [pendingTaskIds]);

  async function startTimer(taskId: string) {
    setPending(taskId, true);
    try {
      const res = await fetch("/api/v1/timers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_id: taskId }),
      });
      if (res.status === 409) {
        toast.error("A timer is already running for this task");
        await fetchTimers();
        return;
      }
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: null }));
        throw new Error(error?.message ?? "Failed to start timer");
      }
      const { data } = await res.json();
      setTimers((prev) => [...prev, data as ActiveTimerWithJoins]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start timer");
    } finally {
      setPending(taskId, false);
    }
  }

  async function stopTimer(timerId: string): Promise<TimeEntryWithJoins | null> {
    const timer = timers.find((t) => t.id === timerId);
    if (timer) setPending(timer.task_id, true);
    try {
      const res = await fetch(`/api/v1/timers/${timerId}/stop`, { method: "POST" });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: null }));
        toast.error(error?.message ?? "Failed to stop timer");
        await fetchTimers();
        return null;
      }
      const { data } = await res.json();
      setTimers((prev) => prev.filter((t) => t.id !== timerId));
      toast.success("Time logged");
      return data as TimeEntryWithJoins;
    } catch {
      toast.error("Failed to stop timer");
      return null;
    } finally {
      if (timer) setPending(timer.task_id, false);
    }
  }

  async function discardTimer(timerId: string) {
    const timer = timers.find((t) => t.id === timerId);
    if (timer) setPending(timer.task_id, true);
    try {
      const res = await fetch(`/api/v1/timers/${timerId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to discard timer");
      setTimers((prev) => prev.filter((t) => t.id !== timerId));
    } catch {
      toast.error("Failed to discard timer");
    } finally {
      if (timer) setPending(timer.task_id, false);
    }
  }

  return {
    timers,
    loading,
    now,
    isTaskRunning,
    isPending,
    startTimer,
    stopTimer,
    discardTimer,
    refetch: fetchTimers,
  };
}

const ActiveTimersContext = createContext<UseActiveTimersResult | null>(null);

export function ActiveTimersProvider({ children }: { children: ReactNode }) {
  const value = useActiveTimers();
  return createElement(ActiveTimersContext.Provider, { value }, children);
}

export function useActiveTimersContext(): UseActiveTimersResult {
  const ctx = useContext(ActiveTimersContext);
  if (!ctx) throw new Error("useActiveTimersContext must be used within an ActiveTimersProvider");
  return ctx;
}

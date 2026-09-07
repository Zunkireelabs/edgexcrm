"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Timer as TimerIcon, Square } from "lucide-react";
import { selectPrimaryTimer } from "@/lib/timers/select-timer";
import { TIMERS_CHANGED_EVENT, notifyTimersChanged } from "@/lib/timers/timer-events";

interface ActiveTimerRow {
  id: string;
  task_id: string;
  started_at: string;
  tasks: { id: string; title: string } | null;
  projects: { id: string; name: string; accounts: { id: string; name: string } | null } | null;
}

/** MM:SS under 1h, H:MM:SS under 10h, "Hh Mm" beyond that (a timer left running overnight). */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h >= 10) return `${h}h ${m}m`;
  if (h === 0) return `${m}:${String(s).padStart(2, "0")}`;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Global running-timer chip — mounted in the shell header on every page, not
 * only /time-tracking. Half-measures (a panel on one page) don't solve
 * "timer left running unnoticed", which is why this exists (Phase 3).
 *
 * The parent MUST only mount this when `FEATURES.TIME_TRACKING` is on for the
 * tenant (see shell.tsx) — that gate, not anything in here, is what keeps a
 * tenant without the feature from issuing a single `/api/v1/timers` request.
 */
export function RunningTimerChip() {
  const router = useRouter();
  const [timers, setTimers] = useState<ActiveTimerRow[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [stopping, setStopping] = useState(false);

  const fetchTimers = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/timers");
      if (!res.ok) return;
      const { data } = await res.json();
      setTimers((data ?? []) as ActiveTimerRow[]);
    } catch {
      // Best-effort — the focus/timers-changed listener below retries.
    }
  }, []);

  // Fetch once on mount.
  useEffect(() => {
    fetchTimers();
  }, [fetchTimers]);

  // Re-fetch on window focus (another tab/device may have started or stopped
  // a timer) and whenever anything in this tab changes timer state (a Home
  // task row's start/stop, or this chip's own stop button) — never poll.
  useEffect(() => {
    function refetch() {
      fetchTimers();
    }
    window.addEventListener("focus", refetch);
    window.addEventListener(TIMERS_CHANGED_EVENT, refetch);
    return () => {
      window.removeEventListener("focus", refetch);
      window.removeEventListener(TIMERS_CHANGED_EVENT, refetch);
    };
  }, [fetchTimers]);

  // Client-side ticking clock — only runs while a timer is actually showing.
  useEffect(() => {
    if (timers.length === 0) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [timers.length]);

  const selection = selectPrimaryTimer(timers);
  if (!selection) return null;
  const { primary, extraCount } = selection;

  async function handleStop() {
    setStopping(true);
    try {
      const res = await fetch(`/api/v1/timers/${primary.id}/stop`, { method: "POST" });
      if (res.ok) {
        setTimers((prev) => prev.filter((t) => t.id !== primary.id));
        notifyTimersChanged();
      }
    } finally {
      setStopping(false);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => router.push("/time-tracking")}
        title={primary.tasks?.title ?? "Running timer"}
        className="flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-[8px] border border-red-200 bg-red-50 text-sm font-medium text-red-700 hover:bg-red-100 transition-colors"
      >
        <TimerIcon className="w-4 h-4 shrink-0" />
        <span className="hidden sm:inline truncate max-w-[140px]">{primary.tasks?.title ?? "Timer"}</span>
        <span className="tabular-nums shrink-0">{formatElapsed(now - Date.parse(primary.started_at))}</span>
        {extraCount > 0 && <span className="text-xs shrink-0">+{extraCount}</span>}
      </button>
      <button
        type="button"
        aria-label="Stop timer"
        title="Stop timer"
        disabled={stopping}
        onClick={handleStop}
        className="flex items-center justify-center h-8 w-8 shrink-0 rounded-[8px] border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50 transition-colors"
      >
        <Square className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

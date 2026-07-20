"use client";

import { Square, X, Timer as TimerIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useActiveTimersContext, formatElapsed } from "../hooks/use-active-timers";
import type { TimeEntryWithJoins } from "../hooks/use-time-entries";

interface RunningTimersPanelProps {
  onStopped: (entry: TimeEntryWithJoins) => void;
}

export function RunningTimersPanel({ onStopped }: RunningTimersPanelProps) {
  const { timers, isPending, stopTimer, discardTimer, now } = useActiveTimersContext();

  if (timers.length === 0) return null;

  async function handleStop(timerId: string) {
    const entry = await stopTimer(timerId);
    if (entry) onStopped(entry);
  }

  return (
    <Card className="border-dashed">
      <CardContent className="py-3 px-4 space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <TimerIcon className="h-3.5 w-3.5" />
          Running timers
        </div>
        <div className="divide-y">
          {timers.map((timer) => {
            const pending = isPending(timer.task_id);
            return (
              <div key={timer.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{timer.tasks?.title ?? "Untitled task"}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {timer.projects?.accounts?.name ? `${timer.projects.accounts.name} · ` : ""}
                    {timer.projects?.name ?? ""}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm tabular-nums text-red-600 font-medium">
                    {formatElapsed(now - Date.parse(timer.started_at))}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 gap-1.5"
                    disabled={pending}
                    onClick={() => handleStop(timer.id)}
                  >
                    <Square className="h-3.5 w-3.5" />
                    Stop
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    disabled={pending}
                    onClick={() => discardTimer(timer.id)}
                    title="Discard timer (no time logged)"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

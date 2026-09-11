"use client";

import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { toLocalDateString } from "@/lib/date";
import { cn } from "@/lib/utils";

export interface TaskDueDateFieldProps {
  value: string | null;
  onChange: (value: string | null) => void;
  canEdit: boolean;
  /** due_date < today && status !== "done" — computed by the caller, which has task.status. */
  overdue: boolean;
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDueDate(dateStr: string, today: string): string {
  if (dateStr === today) return "Today";
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Due-date control for the task detail panel (Round 2 slice C §2.6). No
 * calendar dependency — quick-set buttons + a native <input type="date">.
 * `today`/quick dates use toLocalDateString (browser-local), exactly like
 * task-list.tsx/task-row.tsx — NOT tenant-timezone-aware by design (see the
 * brief: fixing that pre-existing drift in one component only would make it
 * worse, not better).
 */
export function TaskDueDateField({ value, onChange, canEdit, overdue }: TaskDueDateFieldProps) {
  const [open, setOpen] = useState(false);
  const today = toLocalDateString(new Date());
  const label = value ? formatDueDate(value, today) : "Set due date";

  const textCls = overdue ? "text-red-600 font-medium" : value ? "text-foreground" : "text-muted-foreground";

  if (!canEdit) {
    return (
      <span className={cn("text-sm inline-flex items-center gap-1", textCls)} title={overdue ? "Overdue" : undefined}>
        {overdue && <span aria-hidden="true">⚠</span>}
        {label}
      </span>
    );
  }

  function pick(date: Date) {
    onChange(toLocalDateString(date));
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "text-sm inline-flex items-center gap-1 rounded-md px-1.5 py-1.5 -mx-1.5 min-h-10 hover:bg-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            textCls,
          )}
          title={overdue ? "Overdue" : undefined}
        >
          {overdue && <span aria-hidden="true">⚠</span>}
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3 space-y-2">
        <div className="flex flex-col gap-1">
          <Button variant="ghost" size="sm" className="justify-start" onClick={() => pick(new Date())}>
            Today
          </Button>
          <Button variant="ghost" size="sm" className="justify-start" onClick={() => pick(addDays(new Date(), 1))}>
            Tomorrow
          </Button>
          <Button variant="ghost" size="sm" className="justify-start" onClick={() => pick(addDays(new Date(), 7))}>
            Next week
          </Button>
        </div>
        <div className="border-t border-border pt-2">
          <input
            type="date"
            value={value ?? ""}
            onChange={(e) => {
              onChange(e.target.value || null);
              setOpen(false);
            }}
            className="w-full text-sm border border-input rounded-md px-2 py-1.5 bg-transparent focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        {value && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            Clear
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { TimeOfDayPicker } from "./time-of-day-picker";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DEFAULT_SEND_WINDOW, describeSendWindow, type SendWindow } from "../lib/send-window";

// "When emails go out" — the sequence's send window (Phase 3, migration 260). Off = a step goes out as soon as it is
// due (the old behaviour). On = only on the chosen days, from the chosen time, in the lead's (or the office's)
// timezone, spread over a stretch so a big batch is released gradually instead of all at once.

const DAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

const SPREADS = [
  { value: "0", label: "Exactly at that time" },
  { value: "60", label: "Spread over 1 hour" },
  { value: "120", label: "Spread over 2 hours" },
  { value: "240", label: "Spread over 4 hours" },
  { value: "480", label: "Spread over 8 hours" },
];

interface SendWindowEditorProps {
  value: SendWindow | null;
  onChange: (value: SendWindow | null) => void;
  /** What "turn on" starts from — the tenant's working days (from send-window-defaults). */
  defaultWindow?: SendWindow;
  officeTimeZone?: string;
}

function summary(w: SendWindow, tz: string | undefined): string {
  const where = w.timezone_mode === "lead" ? "the lead's timezone" : `the office's timezone${tz ? ` (${tz})` : ""}`;
  return `Emails go out ${describeSendWindow(w)}, in ${where}.`;
}

export function SendWindowEditor({ value, onChange, defaultWindow, officeTimeZone }: SendWindowEditorProps) {
  const on = value !== null;

  const toggleDay = (day: number) => {
    if (!value) return;
    const days = value.days.includes(day) ? value.days.filter((d) => d !== day) : [...value.days, day];
    if (days.length === 0) return; // at least one day must stay on
    onChange({ ...value, days: days.sort((a, b) => a - b) });
  };

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-start gap-2">
        <Checkbox
          id="seq-send-window"
          checked={on}
          onCheckedChange={(checked) =>
            onChange(checked === true ? { ...(defaultWindow ?? DEFAULT_SEND_WINDOW) } : null)
          }
        />
        <div className="space-y-0.5">
          <Label htmlFor="seq-send-window" className="cursor-pointer text-sm font-normal">
            Send at set times
          </Label>
          <p className="text-xs text-muted-foreground">
            Off: each email goes out as soon as it is due, any day, any hour. On: only on the days and at the time you
            choose — and the first email waits for the next window too (use Send now on a draft to send earlier).
          </p>
        </div>
      </div>

      {on && value && (
        <div className="space-y-3 pl-6">
          <div className="space-y-1.5">
            <Label className="text-xs">Days</Label>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days emails may go out">
              {DAYS.map((d) => {
                const active = value.days.includes(d.value);
                return (
                  <button
                    key={d.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleDay(d.value)}
                    className={`rounded border px-2.5 py-1 text-xs transition-colors ${
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="seq-window-time" className="text-xs">
                From
              </Label>
              <TimeOfDayPicker
                id="seq-window-time"
                ariaLabel="Send window start"
                value={value.time}
                onChange={(t) => t && onChange({ ...value, time: t })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="seq-window-spread" className="text-xs">
                Release
              </Label>
              <Select
                value={String(value.spread_minutes)}
                onValueChange={(v) => onChange({ ...value, spread_minutes: Number(v) })}
              >
                <SelectTrigger id="seq-window-spread" className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SPREADS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="seq-window-tz" className="text-xs">
                Timezone
              </Label>
              <Select
                value={value.timezone_mode}
                onValueChange={(v) => onChange({ ...value, timezone_mode: v as "lead" | "office" })}
              >
                <SelectTrigger id="seq-window-tz" className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lead">The lead&apos;s timezone</SelectItem>
                  <SelectItem value="office">The office&apos;s timezone</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">{summary(value, officeTimeZone)}</p>
          {value.timezone_mode === "lead" && (
            <p className="text-xs text-muted-foreground">
              The lead&apos;s timezone comes from their country; if it isn&apos;t recognised, the office&apos;s timezone
              {officeTimeZone ? ` (${officeTimeZone})` : ""} is used. Countries with several timezones use their main
              one.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

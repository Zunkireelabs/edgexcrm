"use client";

import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatTime12 } from "../lib/time-format";

// One simple dropdown of readable times — "9:00 AM", "9:30 AM", "3:00 PM" — in half-hour steps. (The browser's own
// <input type="time"> shows a 24-hour list with no AM / PM on many machines, and separate hour / minute / AM-PM boxes
// were confusing.) The value in and out is still the 24-hour "HH:MM" the rest of the system uses, or "" when
// `allowEmpty` and nothing is chosen.

const selectClass =
  "h-8 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

/** Every half hour of the day as 24-hour "HH:MM", midnight first. */
const HALF_HOURS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 === 0 ? "00" : "30"}`);

const NONE = "none"; // Radix items can't have an empty value

interface TimeOfDayPickerProps {
  value: string; // "HH:MM" 24 h, or ""
  onChange: (value: string) => void;
  /** Offer an entry that clears the value (its text is `emptyLabel`). */
  allowEmpty?: boolean;
  emptyLabel?: string;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
  className?: string;
}

export function TimeOfDayPicker({
  value,
  onChange,
  allowEmpty = false,
  emptyLabel = "Window time",
  disabled,
  id,
  ariaLabel = "Time",
  className,
}: TimeOfDayPickerProps) {
  // a value that isn't on the half-hour grid (e.g. 10:15 saved earlier) is still listed, not silently changed
  const options = value && !HALF_HOURS.includes(value) && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? [...HALF_HOURS, value].sort() : HALF_HOURS;

  return (
    <Select value={value || NONE} disabled={disabled} onValueChange={(v) => onChange(v === NONE ? "" : v)}>
      <SelectTrigger id={id} aria-label={ariaLabel} className={cn("h-8 w-auto min-w-[7.5rem] px-2", className)}>
        <SelectValue placeholder="Pick a time" />
      </SelectTrigger>
      <SelectContent className="max-h-64">
        {(allowEmpty || !value) && <SelectItem value={NONE}>{allowEmpty ? emptyLabel : "Pick a time"}</SelectItem>}
        {options.map((t) => (
          <SelectItem key={t} value={t}>
            {formatTime12(t)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface DateTimePickerProps {
  /** "YYYY-MM-DDTHH:mm" in the viewer's local time (what <input type="datetime-local"> used), or "". */
  value: string;
  onChange: (value: string) => void;
  /** Earliest allowed "YYYY-MM-DDTHH:mm" (date part limits the calendar; the caller still validates the time). */
  min?: string;
  id?: string;
  ariaLabel?: string;
}

/** Date + 12-hour time with AM / PM, in place of <input type="datetime-local"> (which is 24-hour on many machines). */
export function DateTimePicker({ value, onChange, min, id, ariaLabel = "Send on" }: DateTimePickerProps) {
  const [date = "", time = ""] = value.split("T");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        id={id}
        type="date"
        aria-label={`${ariaLabel} — date`}
        className={cn(selectClass, "h-9 px-3")}
        value={date}
        min={min ? min.split("T")[0] : undefined}
        onChange={(e) => onChange(e.target.value ? `${e.target.value}T${time || "09:00"}` : "")}
      />
      <TimeOfDayPicker
        ariaLabel={`${ariaLabel} — time`}
        value={time}
        onChange={(t) => onChange(date ? `${date}T${t || "09:00"}` : "")}
      />
    </div>
  );
}

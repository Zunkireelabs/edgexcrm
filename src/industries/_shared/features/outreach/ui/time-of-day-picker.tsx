"use client";

import { cn } from "@/lib/utils";
import { joinTime, splitTime } from "../lib/time-format";

// A 12-hour time picker with an explicit AM / PM — the browser's <input type="time"> shows a 24-hour list (no AM / PM)
// on many machines, which is easy to misread. The value in and out is still the 24-hour "HH:MM" the rest of the
// system uses, or "" when `allowEmpty` and nothing is chosen.

const selectClass =
  "h-8 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

interface TimeOfDayPickerProps {
  value: string; // "HH:MM" 24 h, or ""
  onChange: (value: string) => void;
  /** Show a "—" hour that clears the value. */
  allowEmpty?: boolean;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
  className?: string;
}

export function TimeOfDayPicker({ value, onChange, allowEmpty = false, disabled, id, ariaLabel = "Time", className }: TimeOfDayPickerProps) {
  const parts = splitTime(value);
  const empty = !parts;
  // a minute that isn't on the 5-minute grid (an older value) is still shown, not silently changed
  const minutes = parts && !MINUTES.includes(parts.minute) ? [...MINUTES, parts.minute].sort((a, b) => a - b) : MINUTES;

  const hour = parts?.hour12 ?? 0;
  const minute = parts?.minute ?? 0;
  const pm = parts?.pm ?? false;

  return (
    <div className={cn("inline-flex items-center gap-1", className)} role="group" aria-label={ariaLabel}>
      <select
        id={id}
        aria-label={`${ariaLabel} — hour`}
        className={selectClass}
        disabled={disabled}
        value={empty ? "" : String(hour)}
        onChange={(e) => {
          if (e.target.value === "") return onChange("");
          onChange(joinTime(Number(e.target.value), minute, pm));
        }}
      >
        {(allowEmpty || empty) && <option value="">{allowEmpty ? "—" : "Hour"}</option>}
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span aria-hidden>:</span>
      <select
        aria-label={`${ariaLabel} — minute`}
        className={selectClass}
        disabled={disabled || empty}
        value={String(minute)}
        onChange={(e) => onChange(joinTime(hour, Number(e.target.value), pm))}
      >
        {minutes.map((m) => (
          <option key={m} value={m}>
            {String(m).padStart(2, "0")}
          </option>
        ))}
      </select>
      <select
        aria-label={`${ariaLabel} — AM or PM`}
        className={selectClass}
        disabled={disabled || empty}
        value={pm ? "PM" : "AM"}
        onChange={(e) => onChange(joinTime(hour, minute, e.target.value === "PM"))}
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
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
        ariaLabel={ariaLabel}
        value={time}
        onChange={(t) => onChange(date ? `${date}T${t || "09:00"}` : "")}
      />
    </div>
  );
}

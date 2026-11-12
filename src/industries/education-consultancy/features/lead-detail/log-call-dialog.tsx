"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarIcon, CaretDownIcon, CircleNotchIcon, PhoneIcon } from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DialogBar, NOTE_AREA } from "./move-dialogs";
import { restoreOrigin } from "./focus-origin";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogKeyHint } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import type { CallOutcome, LeadActivityRecord } from "@/types/database";
import { whenToIso } from "./lib/move-model";

const OUTCOMES: { value: CallOutcome; label: string; subject: string }[] = [
  { value: "connected", label: "Connected", subject: "Connected" },
  { value: "no_answer", label: "No answer", subject: "No Answer" },
  { value: "busy", label: "Busy", subject: "Busy" },
  { value: "left_voicemail", label: "Voicemail", subject: "Left Voicemail" },
  { value: "wrong_number", label: "Wrong no.", subject: "Wrong Number" },
];

/** `<input type="datetime-local">` value for a Date, in the browser's own zone. */
export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** "Today, 10:42" / "Yesterday, 16:30" / "Nov 9, 16:30" for a `datetime-local` value. */
export function whenLabel(local: string, now: Date = new Date()): string {
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return "Pick a time";
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  const date = diff === 0 ? "Today" : diff === 1 ? "Yesterday" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
  return `${date}, ${time}`;
}

/**
 * The When field: a select-style trigger reading "Today, 10:42" that opens a small date + time picker (past only). No shared date
 * picker exists in the app (only native inputs), so this is the one place that wraps them.
 */
function WhenPicker({ value, onChange, max, error }: { value: string; onChange: (v: string) => void; max: string; error: string | null }) {
  const [open, setOpen] = useState(false);
  const [date, time] = value.split("T");
  const set = (d: string, t: string) => onChange(`${d || max.slice(0, 10)}T${t || "00:00"}`);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button" id="call-when" aria-label={`When: ${whenLabel(value)}`} data-invalid={error ? "true" : undefined}
          className="flex h-9 w-full items-center justify-between gap-2 rounded-[9px] border border-input bg-transparent px-3 text-left text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[invalid=true]:border-destructive"
        >
          <span className="flex min-w-0 items-center gap-2"><CalendarIcon className="size-4 shrink-0 text-ds-faint" aria-hidden /><span className="truncate">{whenLabel(value)}</span></span>
          <CaretDownIcon className="size-4 opacity-50" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[260px] space-y-2 p-3">
        <div className="space-y-1.5"><Label htmlFor="call-when-date">Date</Label><Input id="call-when-date" type="date" max={max.slice(0, 10)} value={date ?? ""} onChange={(e) => set(e.target.value, time)} /></div>
        <div className="space-y-1.5"><Label htmlFor="call-when-time">Time</Label><Input id="call-when-time" type="time" value={time ?? ""} onChange={(e) => set(date, e.target.value)} /></div>
        <div className="flex justify-between pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => { onChange(max); }}>Now</Button>
          <Button type="button" size="sm" onClick={() => setOpen(false)}>Done</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Log call (flow 12), a Dialogs v1 dialog: outcome as segmented choices, duration, WHEN (defaults to now, past only) and
 * notes; the footer toggle "Also set a follow-up task" opens the task composer afterwards. Same payload as today's modal
 * (call_outcome, duration_minutes, subject) plus `created_at` when the call happened earlier.
 */
export function LogCallDialog({
  open, onOpenChange, leadId, leadName, onLogged, onFollowUp,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  leadName: string;
  onLogged: (a: LeadActivityRecord) => void;
  onFollowUp: () => void;
}) {
  const [outcome, setOutcome] = useState<CallOutcome>("connected");
  const [duration, setDuration] = useState("");
  const [when, setWhen] = useState("");
  const [notes, setNotes] = useState("");
  const [followUp, setFollowUp] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setOutcome("connected"); setDuration(""); setNotes(""); setFollowUp(false);
    setWhen(toLocalInput(new Date()));
  }, [open]);

  const nowMax = toLocalInput(new Date());
  const parsed = whenToIso(when);

  const submit = async () => {
    if (saving || parsed.error) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        activity_type: "call",
        call_outcome: outcome,
        duration_minutes: duration ? parseInt(duration, 10) : null,
        subject: `Call - ${OUTCOMES.find((o) => o.value === outcome)?.subject}`,
        description: notes || null,
      };
      if (parsed.iso) body.created_at = parsed.iso;
      const res = await fetch(`/api/v1/leads/${leadId}/activities`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error();
      onLogged((await res.json()).data as LeadActivityRecord);
      toast.success("Call logged");
      onOpenChange(false);
      if (followUp) onFollowUp();
    } catch {
      toast.error("Failed to log activity");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent size="md" aria-describedby={undefined} onCloseAutoFocus={restoreOrigin}>
        <DialogBar icon={PhoneIcon} title="Log call" sub={leadName} />
        <form
          id="log-call-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void submit(); } }}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <Label>Outcome</Label>
            <SegmentedControl aria-label="Outcome" className="flex w-full [&>button]:flex-1 [&>button]:justify-center [&>button]:text-center" value={outcome} onValueChange={(v) => setOutcome(v as CallOutcome)} items={OUTCOMES.map((o) => ({ value: o.value, label: o.label }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="call-duration">Duration (min)</Label>
              <Input id="call-duration" type="number" min="0" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="e.g. 12" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="call-when">When</Label>
              <WhenPicker value={when} onChange={setWhen} max={nowMax} error={parsed.error} />
              {parsed.error && <p role="alert" className="m-0 text-[12px] leading-4 text-ds-bad">{parsed.error}</p>}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="call-notes">Notes</Label>
            <Textarea id="call-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What was said, what happens next" className={NOTE_AREA} />
          </div>
        </form>
        <DialogFooter>
          <label className="mr-auto flex cursor-pointer items-center gap-2 text-[13px] text-ds-muted">
            <Checkbox checked={followUp} onCheckedChange={(c) => setFollowUp(c === true)} aria-label="Also set a follow-up task" />
            Also set a follow-up task
          </label>
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button type="submit" form="log-call-form" disabled={saving || !!parsed.error}>
            {saving && <CircleNotchIcon className="size-4 animate-spin" />}Log call <DialogKeyHint>⌘↵</DialogKeyHint>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

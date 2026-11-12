"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CircleNotchIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogKeyHint, DialogTitle } from "@/components/ui/dialog";
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
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Log call</DialogTitle>
          <DialogDescription>{leadName}</DialogDescription>
        </DialogHeader>
        <form
          id="log-call-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void submit(); } }}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <Label>Outcome</Label>
            <SegmentedControl aria-label="Outcome" value={outcome} onValueChange={(v) => setOutcome(v as CallOutcome)} items={OUTCOMES.map((o) => ({ value: o.value, label: o.label }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="call-duration">Duration (min)</Label>
              <Input id="call-duration" type="number" min="0" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="e.g. 12" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="call-when">When</Label>
              <Input id="call-when" type="datetime-local" max={nowMax} value={when} onChange={(e) => setWhen(e.target.value)} aria-invalid={parsed.error ? true : undefined} />
              {parsed.error && <p role="alert" className="m-0 text-[12px] leading-4 text-ds-bad">{parsed.error}</p>}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="call-notes">Notes</Label>
            <Textarea id="call-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="What was said, what happens next" className="min-h-[72px] resize-none rounded-[9px] text-sm" />
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

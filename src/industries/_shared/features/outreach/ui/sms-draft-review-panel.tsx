"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Loader2, Send, SkipForward } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CharacterCounter } from "@/industries/_shared/features/sms/ui/character-counter";
import { formatDateTime12 } from "../lib/time-format";
import { DateTimePicker } from "./time-of-day-picker";
import type { Draft } from "./today-worklist";

// Review dialog for an SMS sequence step: plain text only (no subject, no rich editor), a live segment/credit counter,
// and the three things a rep can do - Send now, Schedule send, Skip. The email panel (draft-review-panel.tsx) is
// deliberately left alone: its copy / mark-sent / AI / template flows are email-specific.

interface SmsDraftReviewPanelProps {
  draft: Draft | null;
  onOpenChange: (open: boolean) => void;
  onSent: (draftId: string) => void;
  onSkipped: (draftId: string) => void;
  onUpdated: (draft: Draft) => void;
}

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function SmsDraftReviewPanel({ draft, onOpenChange, onSent, onSkipped, onUpdated }: SmsDraftReviewPanelProps) {
  const [body, setBody] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"send" | "schedule" | "skip" | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");

  useEffect(() => {
    if (draft) {
      setBody(draft.body_html);
      setDirty(false);
      setScheduleOpen(false);
    }
  }, [draft]);

  if (!draft) return null;

  const leadName = [draft.leads?.first_name, draft.leads?.last_name].filter(Boolean).join(" ") || "Unknown lead";
  const sequenceName = draft.sequence_enrollments?.email_sequences?.name;
  const empty = !body.trim();

  // The send and schedule routes read the saved draft, so unsaved edits are saved first.
  const saveEdits = async (): Promise<boolean> => {
    if (!dirty) return true;
    const res = await fetch(`/api/v1/outreach/drafts/${draft.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body_html: body }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      toast.error(json?.error?.message ?? "Couldn't save your changes");
      return false;
    }
    setDirty(false);
    return true;
  };

  const handleSend = async () => {
    setBusy("send");
    try {
      if (!(await saveEdits())) return;
      const res = await fetch(`/api/v1/outreach/drafts/${draft.id}/send`, { method: "POST" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        // The draft stays pending on every failure, so the rep can retry, schedule or skip.
        toast.error(json?.error?.message ?? "The text couldn't be sent");
        return;
      }
      toast.success("Text sent");
      onSent(draft.id);
    } finally {
      setBusy(null);
    }
  };

  const openSchedule = () => {
    const existing = draft.scheduled_send_at ? new Date(draft.scheduled_send_at) : null;
    const tomorrow10 = new Date();
    tomorrow10.setDate(tomorrow10.getDate() + 1);
    tomorrow10.setHours(10, 0, 0, 0);
    setScheduleAt(toLocalInputValue(existing ?? tomorrow10));
    setScheduleOpen(true);
  };

  const handleSchedule = async () => {
    const when = new Date(scheduleAt);
    if (Number.isNaN(when.getTime())) {
      toast.error("Pick a date and time");
      return;
    }
    setBusy("schedule");
    try {
      if (!(await saveEdits())) return;
      const res = await fetch(`/api/v1/outreach/drafts/${draft.id}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ send_at: when.toISOString() }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(json?.error?.message ?? "Couldn't schedule the text");
        return;
      }
      toast.success(`Scheduled for ${formatDateTime12(when)}`);
      setScheduleOpen(false);
      onUpdated({ ...draft, body_html: body, scheduled_send_at: json.data?.scheduled_send_at ?? when.toISOString(), scheduled_error: null });
    } finally {
      setBusy(null);
    }
  };

  const handleSkip = async () => {
    setBusy("skip");
    try {
      const res = await fetch(`/api/v1/outreach/drafts/${draft.id}/skip`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        toast.error(json?.error?.message ?? "Failed to skip");
        return;
      }
      toast.success("Step skipped");
      onSkipped(draft.id);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={draft !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {leadName} <Badge variant="outline">SMS</Badge>
          </DialogTitle>
          <DialogDescription>
            {sequenceName ? `${sequenceName} · ` : ""}Step {draft.step_order}. Plain text; your sender name and the opt-out link are added when it sends.
          </DialogDescription>
        </DialogHeader>

        {draft.scheduled_error && <p className="text-xs text-destructive">{draft.scheduled_error}</p>}
        {draft.scheduled_send_at && (
          <p className="text-xs text-muted-foreground">Scheduled for {formatDateTime12(new Date(draft.scheduled_send_at))}</p>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="sms-draft-body">Message</Label>
          <Textarea
            id="sms-draft-body"
            rows={6}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setDirty(true);
            }}
          />
          <CharacterCounter body={body} prefix="" footer="" />
        </div>

        {scheduleOpen && (
          <div className="space-y-2 rounded-md border p-3">
            <Label>Send at</Label>
            <DateTimePicker value={scheduleAt} onChange={setScheduleAt} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setScheduleOpen(false)} disabled={busy !== null}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={handleSchedule} disabled={busy !== null || empty}>
                {busy === "schedule" && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />} Schedule
              </Button>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="ghost" onClick={handleSkip} disabled={busy !== null}>
            {busy === "skip" ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <SkipForward className="h-4 w-4 mr-1.5" />}
            Skip step
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={openSchedule} disabled={busy !== null || empty}>
              <CalendarClock className="h-4 w-4 mr-1.5" /> {draft.scheduled_send_at ? "Reschedule" : "Schedule send"}
            </Button>
            <Button type="button" onClick={handleSend} disabled={busy !== null || empty}>
              {busy === "send" ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
              Send now
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

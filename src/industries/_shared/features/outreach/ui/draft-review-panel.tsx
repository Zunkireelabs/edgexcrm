"use client";

import { useState, useEffect } from "react";
import { Copy, Loader2, SkipForward, Send, Sparkles, BookmarkPlus, Mail, CalendarClock } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { TipTapEditor } from "@/industries/_shared/features/email/components/tiptap-editor";
import { HtmlSourceEditor } from "@/industries/_shared/features/email/components/html-source-editor";
import { detectBodyMode, type StepBodyMode } from "../lib/body-format";
import type { Draft } from "./today-worklist";
import { formatDateTime12 } from "../lib/time-format";
import { DateTimePicker } from "./time-of-day-picker";

interface DraftReviewPanelProps {
  draft: Draft | null;
  isAdmin: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: (draftId: string) => void;
  onSkipped: (draftId: string) => void;
  onUpdated: (draft: Draft) => void;
}

interface SendCapability {
  enabled: boolean;
  sandbox: boolean;
  from: string | null;
  replyTo: string | null;
  usingPlatformAddress: boolean;
}

interface SequenceStepPayload {
  step_order: number;
  delay_days: number;
  subject_template: string;
  body_template: string;
  draft_source: string;
  ai_instructions: string | null;
}

// Strips HTML tags for a plain-text clipboard fallback so "Copy body" still
// works in editors that don't accept the rich text/html clipboard type.
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export function DraftReviewPanel({ draft, isAdmin, onOpenChange, onSent, onSkipped, onUpdated }: DraftReviewPanelProps) {
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [dirty, setDirty] = useState(false);
  const [sending, setSending] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [aiDraftEnabled, setAiDraftEnabled] = useState(false);
  const [sendCapability, setSendCapability] = useState<SendCapability | null>(null);
  const [sendNowOpen, setSendNowOpen] = useState(false);
  const [sendingNow, setSendingNow] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  const [scheduling, setScheduling] = useState(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [templateSubject, setTemplateSubject] = useState("");
  const [templateBody, setTemplateBody] = useState("");
  // Designed-HTML drafts (from an HTML-mode step) must not go through TipTap, which would
  // strip the design on edit. Mode is fixed when the draft / template dialog loads.
  const [bodyMode, setBodyMode] = useState<StepBodyMode>("rich");
  const [templateMode, setTemplateMode] = useState<StepBodyMode>("rich");
  const [savingTemplate, setSavingTemplate] = useState(false);

  useEffect(() => {
    if (draft) {
      setSubject(draft.subject);
      setBodyHtml(draft.body_html);
      setBodyMode(detectBodyMode(draft.body_html));
      setDirty(false);
    }
  }, [draft]);

  // Capability check, not a security boundary — the regenerate route re-checks
  // the D5 gate server-side. Fetched once; the gate doesn't flip mid-session.
  useEffect(() => {
    fetch("/api/v1/outreach/ai-draft-status")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => setAiDraftEnabled(json?.data?.enabled === true))
      .catch(() => setAiDraftEnabled(false));
  }, []);

  // Whether EdgeX can send for this tenant, and from which address. Hidden entirely when off, so the
  // manual Copy / Mark sent flow is exactly as before. The send route re-checks everything server-side.
  useEffect(() => {
    fetch("/api/v1/outreach/send-capability")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => setSendCapability(json?.data?.enabled === true ? (json.data as SendCapability) : null))
      .catch(() => setSendCapability(null));
  }, []);

  if (!draft) return null;

  const leadName = [draft.leads?.first_name, draft.leads?.last_name].filter(Boolean).join(" ") || "Unknown lead";

  const copySubject = async () => {
    try {
      await navigator.clipboard.writeText(subject);
      toast.success("Subject copied");
    } catch {
      toast.error("Couldn't copy subject");
    }
  };

  const copyBody = async () => {
    try {
      if (navigator.clipboard.write) {
        const item = new ClipboardItem({
          "text/html": new Blob([bodyHtml], { type: "text/html" }),
          "text/plain": new Blob([stripHtml(bodyHtml)], { type: "text/plain" }),
        });
        await navigator.clipboard.write([item]);
      } else {
        await navigator.clipboard.writeText(stripHtml(bodyHtml));
      }
      toast.success("Body copied — paste into your inbox");
    } catch {
      toast.error("Couldn't copy body");
    }
  };

  const handleMarkSent = async () => {
    setSending(true);
    try {
      if (dirty) {
        const patchRes = await fetch(`/api/v1/outreach/drafts/${draft.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subject, body_html: bodyHtml }),
        });
        if (!patchRes.ok) {
          const json = await patchRes.json().catch(() => null);
          toast.error(json?.error?.message ?? "Failed to save your edits");
          return;
        }
      }

      const res = await fetch(`/api/v1/outreach/drafts/${draft.id}/send-log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ edited: dirty }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json?.error?.message ?? "Failed to log the send");
        return;
      }

      toast.success("Logged to timeline");
      onSent(draft.id);
    } finally {
      setSending(false);
    }
  };

  const subjectMissing = !subject.trim();

  const handleSendNow = async () => {
    if (subjectMissing) {
      toast.error("Add a subject before sending");
      return;
    }
    setSendingNow(true);
    try {
      if (dirty) {
        const patchRes = await fetch(`/api/v1/outreach/drafts/${draft.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subject, body_html: bodyHtml }),
        });
        if (!patchRes.ok) {
          const json = await patchRes.json().catch(() => null);
          toast.error(json?.error?.message ?? "Failed to save your edits");
          return;
        }
      }

      const res = await fetch(`/api/v1/outreach/drafts/${draft.id}/send`, { method: "POST" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        // The draft stays pending on every failure, so the rep can retry, skip, or send it manually.
        toast.error(json?.error?.message ?? "The email couldn't be sent");
        setSendNowOpen(false);
        return;
      }

      toast.success(sendCapability?.sandbox ? "Sent in sandbox (test address only)" : "Email sent");
      setSendNowOpen(false);
      onSent(draft.id);
    } finally {
      setSendingNow(false);
    }
  };

  // <input type="datetime-local"> works in the user's local time with no zone; format a Date that way.
  const toLocalInputValue = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const openSchedule = () => {
    // Re-opening keeps the current schedule; otherwise default to tomorrow 09:00 local.
    const existing = draft.scheduled_send_at ? new Date(draft.scheduled_send_at) : null;
    const tomorrow9 = new Date();
    tomorrow9.setDate(tomorrow9.getDate() + 1);
    tomorrow9.setHours(9, 0, 0, 0);
    setScheduleAt(toLocalInputValue(existing ?? tomorrow9));
    setScheduleOpen(true);
  };

  // Saves any unsaved edits first (the send reads the latest subject/body), then applies `change`.
  const saveEditsThen = async (change: () => Promise<Response>) => {
    if (dirty) {
      const patchRes = await fetch(`/api/v1/outreach/drafts/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body_html: bodyHtml }),
      });
      if (!patchRes.ok) {
        const json = await patchRes.json().catch(() => null);
        toast.error(json?.error?.message ?? "Failed to save your edits");
        return null;
      }
    }
    return change();
  };

  const handleSchedule = async () => {
    const when = new Date(scheduleAt);
    if (!scheduleAt || Number.isNaN(when.getTime())) {
      toast.error("Pick a date and time");
      return;
    }
    setScheduling(true);
    try {
      const res = await saveEditsThen(() =>
        fetch(`/api/v1/outreach/drafts/${draft.id}/schedule`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ send_at: when.toISOString() }),
        })
      );
      if (!res) return;
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(json?.error?.message ?? "Couldn't schedule the send");
        return;
      }
      toast.success(`Scheduled for ${formatDateTime12(when)}`);
      setScheduleOpen(false);
      setDirty(false);
      onUpdated({ ...draft, subject, body_html: bodyHtml, scheduled_send_at: json.data.scheduled_send_at, scheduled_error: null });
    } finally {
      setScheduling(false);
    }
  };

  const handleCancelSchedule = async () => {
    setScheduling(true);
    try {
      const res = await fetch(`/api/v1/outreach/drafts/${draft.id}/schedule`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        toast.error(json?.error?.message ?? "Couldn't cancel the schedule");
        return;
      }
      toast.success("Schedule cancelled");
      onUpdated({ ...draft, subject, body_html: bodyHtml, scheduled_send_at: null, scheduled_error: null });
    } finally {
      setScheduling(false);
    }
  };

  const handleSkip = async () => {
    setSkipping(true);
    try {
      const res = await fetch(`/api/v1/outreach/drafts/${draft.id}/skip`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        toast.error(json?.error?.message ?? "Failed to skip");
        return;
      }
      toast.success("Draft skipped");
      onSkipped(draft.id);
    } finally {
      setSkipping(false);
    }
  };

  const handleDraftWithAI = async () => {
    if (drafting) return;
    setDrafting(true);
    try {
      const res = await fetch(`/api/v1/outreach/drafts/${draft.id}/regenerate`, { method: "POST" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(json?.error?.message ?? "Failed to draft with AI");
        return;
      }
      const updated = json.data as Draft;
      setSubject(updated.subject);
      setBodyHtml(updated.body_html);
      setDirty(false);
      onUpdated(updated);
      toast.success("Drafted with AI");
    } finally {
      setDrafting(false);
    }
  };

  const openSaveAsTemplate = () => {
    setTemplateSubject(subject);
    setTemplateBody(bodyHtml);
    setTemplateMode(detectBodyMode(bodyHtml));
    setSaveTemplateOpen(true);
  };

  const confirmSaveAsTemplate = async () => {
    const sequenceId = draft.sequence_enrollments?.sequence_id;
    if (!sequenceId) return;
    setSavingTemplate(true);
    try {
      const seqRes = await fetch(`/api/v1/outreach/sequences/${sequenceId}`);
      const seqJson = await seqRes.json().catch(() => null);
      if (!seqRes.ok || !seqJson?.data) {
        toast.error("Failed to load the sequence");
        return;
      }
      const steps = (seqJson.data.email_sequence_steps as SequenceStepPayload[]).map((s) =>
        s.step_order === draft.step_order ? { ...s, subject_template: templateSubject, body_template: templateBody } : s
      );

      const patchRes = await fetch(`/api/v1/outreach/sequences/${sequenceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steps }),
      });
      const patchJson = await patchRes.json().catch(() => null);
      if (!patchRes.ok) {
        toast.error(patchJson?.error?.message ?? "Failed to save as template");
        return;
      }
      toast.success("Saved as template — future enrollments start from this copy");
      setSaveTemplateOpen(false);
    } finally {
      setSavingTemplate(false);
    }
  };

  const busy = sending || skipping || sendingNow || scheduling;

  return (
    <Sheet open={!!draft} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {leadName}
            <Badge variant={draft.draft_source === "ai" ? "default" : "outline"} className="text-[10px]">
              {draft.draft_source === "ai" ? "AI-drafted" : "Template"}
            </Badge>
          </SheetTitle>
          <SheetDescription>
            {draft.sequence_enrollments?.email_sequences?.name ?? "Sequence"} · Step {draft.step_order}
            {draft.leads?.email ? ` · ${draft.leads.email}` : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 space-y-3">
          <p className="text-xs text-muted-foreground bg-muted/50 rounded-md p-2">
            {sendCapability ? (
              <>
                Click <strong>Send now</strong> to send this from EdgeX — it&apos;s logged and the next step is scheduled
                automatically. Or copy it into your own inbox, send it there, then come back and click{" "}
                <strong>Mark sent</strong> so the cadence advances and the lead timeline stays accurate.
              </>
            ) : (
              <>
                EdgeX doesn&apos;t send this for you — copy it into your own inbox, send it, then come back and mark
                it sent so the cadence advances and the lead timeline stays accurate.
              </>
            )}
          </p>

          {draft.scheduled_send_at && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-blue-200 bg-blue-50 p-2.5 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
              <span>
                <CalendarClock className="mr-1.5 inline h-3.5 w-3.5" />
                EdgeX will send this on{" "}
                <strong>{formatDateTime12(new Date(draft.scheduled_send_at))}</strong>{" "}
                (within about a minute). You can still edit it until then.
              </span>
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={handleCancelSchedule} disabled={busy}>
                Cancel schedule
              </Button>
            </div>
          )}
          {draft.scheduled_error && !draft.scheduled_send_at && (
            <p className="rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              The scheduled send didn&apos;t go out: {draft.scheduled_error}
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="draft-subject">Subject</Label>
            <Input
              id="draft-subject"
              value={subject}
              onChange={(e) => {
                setSubject(e.target.value);
                setDirty(true);
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Body</Label>
            {bodyMode === "html" ? (
              <HtmlSourceEditor
                value={bodyHtml}
                onChange={(html) => {
                  setBodyHtml(html);
                  setDirty(true);
                }}
                format="html"
                onFormatChange={() => {}}
                showFormatToggle={false}
                hideTestEmailHint
                minHeight={220}
              />
            ) : (
              <TipTapEditor
                value={bodyHtml}
                onChange={(html) => {
                  setBodyHtml(html);
                  setDirty(true);
                }}
                minHeight={220}
              />
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={copySubject}>
              <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy subject
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={copyBody}>
              <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy body
            </Button>
            {aiDraftEnabled && (
              <Button type="button" variant="outline" size="sm" onClick={handleDraftWithAI} disabled={drafting}>
                {drafting ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                )}
                Draft with AI
              </Button>
            )}
            {isAdmin && (
              <Button type="button" variant="outline" size="sm" onClick={openSaveAsTemplate}>
                <BookmarkPlus className="h-3.5 w-3.5 mr-1.5" /> Save as template
              </Button>
            )}
          </div>
        </div>

        <SheetFooter className="flex-row justify-end gap-2">
          <Button type="button" variant="outline" onClick={handleSkip} disabled={busy}>
            {skipping ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <SkipForward className="h-4 w-4 mr-1.5" />}
            Skip
          </Button>
          <Button type="button" variant={sendCapability ? "outline" : "default"} onClick={handleMarkSent} disabled={busy}>
            {sending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
            Mark sent
          </Button>
          {sendCapability && (
            <Button
              type="button"
              variant="outline"
              onClick={openSchedule}
              disabled={busy || subjectMissing}
              title={subjectMissing ? "Add a subject before scheduling" : undefined}
            >
              <CalendarClock className="h-4 w-4 mr-1.5" />
              {draft.scheduled_send_at ? "Reschedule" : "Schedule send"}
            </Button>
          )}
          {sendCapability && (
            <Button
              type="button"
              onClick={() => setSendNowOpen(true)}
              disabled={busy || subjectMissing}
              title={subjectMissing ? "Add a subject before sending" : undefined}
            >
              <Mail className="h-4 w-4 mr-1.5" />
              Send now
            </Button>
          )}
        </SheetFooter>
      </SheetContent>

      <Dialog open={scheduleOpen} onOpenChange={(o) => !scheduling && setScheduleOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Schedule this email</DialogTitle>
            <DialogDescription>EdgeX will send it by itself at the time you pick, then log it on {leadName}&apos;s timeline.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="schedule-at">Send on</Label>
            <DateTimePicker
              id="schedule-at"
              value={scheduleAt}
              min={toLocalInputValue(new Date(Date.now() + 5 * 60 * 1000))}
              onChange={setScheduleAt}
            />
            <p className="text-xs text-muted-foreground">
              Your local time ({Intl.DateTimeFormat().resolvedOptions().timeZone}). At least 5 minutes from now, within 90 days.
            </p>
          </div>
          <dl className="space-y-1.5 text-sm">
            <div className="flex gap-2">
              <dt className="w-14 shrink-0 text-muted-foreground">To</dt>
              <dd className="min-w-0 break-words">{draft.leads?.email ?? "—"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-14 shrink-0 text-muted-foreground">From</dt>
              <dd className="min-w-0 break-words">{sendCapability?.from ?? "—"}</dd>
            </div>
          </dl>
          {sendCapability?.sandbox && (
            <p className="rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              Sandbox is on: it will go to the configured test address, <strong>not</strong> to {leadName}.
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setScheduleOpen(false)} disabled={scheduling}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSchedule} disabled={scheduling}>
              {scheduling ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <CalendarClock className="h-4 w-4 mr-1.5" />}
              Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={sendNowOpen} onOpenChange={(o) => !sendingNow && setSendNowOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send this email now?</DialogTitle>
            <DialogDescription>EdgeX will send it and log it on {leadName}&apos;s timeline.</DialogDescription>
          </DialogHeader>
          <dl className="space-y-1.5 text-sm">
            <div className="flex gap-2">
              <dt className="w-14 shrink-0 text-muted-foreground">To</dt>
              <dd className="min-w-0 break-words">{draft.leads?.email ?? "—"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-14 shrink-0 text-muted-foreground">From</dt>
              <dd className="min-w-0 break-words">{sendCapability?.from ?? "—"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-14 shrink-0 text-muted-foreground">Subject</dt>
              <dd className="min-w-0 break-words font-medium">{subject || "—"}</dd>
            </div>
          </dl>
          {sendCapability?.sandbox && (
            <p className="rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              Sandbox is on: this goes to the configured test address, <strong>not</strong> to {leadName}. The timeline
              will still show it as sent.
            </p>
          )}
          {sendCapability?.usingPlatformAddress && (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              Your own sending domain isn&apos;t verified yet, so this goes out from the shared EdgeX address.
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSendNowOpen(false)} disabled={sendingNow}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSendNow} disabled={sendingNow}>
              {sendingNow ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Mail className="h-4 w-4 mr-1.5" />}
              Send email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={saveTemplateOpen} onOpenChange={setSaveTemplateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Save as template</DialogTitle>
            <DialogDescription>
              This draft was written for {leadName}. Replace lead-specific details with merge tags —{" "}
              <code className="text-xs">{"{{first_name}}"}</code>, <code className="text-xs">{"{{last_name}}"}</code>,{" "}
              <code className="text-xs">{"{{city}}"}</code> — so future leads on this step get a personalized,
              reusable template instead of {leadName}&apos;s exact details.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="template-subject">Subject template</Label>
              <Input id="template-subject" value={templateSubject} onChange={(e) => setTemplateSubject(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Body template</Label>
              {templateMode === "html" ? (
                <HtmlSourceEditor
                  value={templateBody}
                  onChange={setTemplateBody}
                  format="html"
                  onFormatChange={() => {}}
                  showFormatToggle={false}
                  hideTestEmailHint
                  minHeight={200}
                />
              ) : (
                <TipTapEditor value={templateBody} onChange={setTemplateBody} minHeight={200} />
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSaveTemplateOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={confirmSaveAsTemplate} disabled={savingTemplate}>
              {savingTemplate && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Save as step {draft.step_order} template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}

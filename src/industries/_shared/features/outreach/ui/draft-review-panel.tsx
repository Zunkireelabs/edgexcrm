"use client";

import { useState, useEffect } from "react";
import { Copy, Loader2, SkipForward, Send, Sparkles, BookmarkPlus } from "lucide-react";
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
import type { Draft } from "./today-worklist";

interface DraftReviewPanelProps {
  draft: Draft | null;
  isAdmin: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: (draftId: string) => void;
  onSkipped: (draftId: string) => void;
  onUpdated: (draft: Draft) => void;
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
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [templateSubject, setTemplateSubject] = useState("");
  const [templateBody, setTemplateBody] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);

  useEffect(() => {
    if (draft) {
      setSubject(draft.subject);
      setBodyHtml(draft.body_html);
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

  const busy = sending || skipping;

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
            EdgeX doesn&apos;t send this for you — copy it into your own inbox, send it, then come
            back and mark it sent so the cadence advances and the lead timeline stays accurate.
          </p>

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
            <TipTapEditor
              value={bodyHtml}
              onChange={(html) => {
                setBodyHtml(html);
                setDirty(true);
              }}
              minHeight={220}
            />
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
          <Button type="button" onClick={handleMarkSent} disabled={busy}>
            {sending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
            Mark sent
          </Button>
        </SheetFooter>
      </SheetContent>

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
              <TipTapEditor value={templateBody} onChange={setTemplateBody} minHeight={200} />
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

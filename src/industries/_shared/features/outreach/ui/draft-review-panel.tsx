"use client";

import { useState, useEffect } from "react";
import { Copy, Loader2, SkipForward, Send } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { TipTapEditor } from "@/industries/_shared/features/email/components/tiptap-editor";
import type { Draft } from "./today-worklist";

interface DraftReviewPanelProps {
  draft: Draft | null;
  onOpenChange: (open: boolean) => void;
  onSent: (draftId: string) => void;
  onSkipped: (draftId: string) => void;
}

// Strips HTML tags for a plain-text clipboard fallback so "Copy body" still
// works in editors that don't accept the rich text/html clipboard type.
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export function DraftReviewPanel({ draft, onOpenChange, onSent, onSkipped }: DraftReviewPanelProps) {
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [dirty, setDirty] = useState(false);
  const [sending, setSending] = useState(false);
  const [skipping, setSkipping] = useState(false);

  useEffect(() => {
    if (draft) {
      setSubject(draft.subject);
      setBodyHtml(draft.body_html);
      setDirty(false);
    }
  }, [draft]);

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

  const busy = sending || skipping;

  return (
    <Sheet open={!!draft} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{leadName}</SheetTitle>
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

          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={copySubject}>
              <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy subject
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={copyBody}>
              <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy body
            </Button>
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
    </Sheet>
  );
}

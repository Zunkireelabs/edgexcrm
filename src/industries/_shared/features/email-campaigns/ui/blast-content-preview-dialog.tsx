"use client";

// Read-only "what did we send" view for a non-draft blast (sending/
// throttled/sent/partially_failed/failed/cancelled) on blast-detail.tsx.
// Reuses the same POST /api/v1/email-blasts/[id]/preview contract and
// EmailPreviewPane rendering as the draft composer's Review & send dialog
// (send-confirm-dialog.tsx) — same personalized-sample fidelity, just without
// any send/confirm affordance. The preview endpoint reads the blast's current
// subject_template/body_template/audience_filter regardless of blast.status,
// so no backend change was needed for this to work post-send.

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { EmailPreviewPane } from "./email-preview-pane";
import { emailBlastSend, EmailBlastApiError } from "../lib/api-client";
import type { EmailBlastPreviewResponse } from "../lib/types";

interface BlastContentPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blastId: string;
}

export function BlastContentPreviewDialog({ open, onOpenChange, blastId }: BlastContentPreviewDialogProps) {
  const [preview, setPreview] = useState<EmailBlastPreviewResponse | null>(null);
  const [sampleIdx, setSampleIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    setPreview(null);
    setSampleIdx(0);
    emailBlastSend<EmailBlastPreviewResponse>(`/api/v1/email-blasts/${blastId}/preview`, "POST", {})
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof EmailBlastApiError ? e.message : "Failed to load email content.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, blastId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] w-[95vw] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 space-y-1 border-b px-6 py-4 text-left">
          <DialogTitle>Email content</DialogTitle>
          <DialogDescription>What this blast sent, rendered for a real recipient.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Loading preview…</div>
        ) : error ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-destructive">{error}</div>
        ) : preview ? (
          <div className="min-h-0 flex-1">
            <EmailPreviewPane preview={preview} sampleIdx={sampleIdx} onSampleIdxChange={setSampleIdx} />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

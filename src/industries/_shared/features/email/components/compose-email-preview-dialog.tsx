"use client";

// "Preview" in the New email pop-up for a no-reply email: the finished email (logo, colour bar, the message, footer) in an
// inbox-style frame, with Subject / From / Reply-to above it. It is only a thin dialog around the preview pane Email
// Campaigns already use; nothing about previewing is built twice.

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmailPreviewPane } from "@/industries/_shared/features/email-campaigns/ui/email-preview-pane";

interface ComposeEmailPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subject: string;
  /** "Name <address>" */
  from: string;
  replyTo: string | null;
  /** The complete email HTML, exactly what will be sent. */
  html: string;
}

export function ComposeEmailPreviewDialog({ open, onOpenChange, subject, from, replyTo, html }: ComposeEmailPreviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] w-[95vw] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 space-y-1 border-b px-6 py-4 text-left">
          <DialogTitle>Preview</DialogTitle>
          <DialogDescription>The email as the person will receive it.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1">
          <EmailPreviewPane
            preview={{ samples: [{ subject: subject || "(no subject)", bodyHtml: html }], sender: { from, replyTo } }}
            sampleIdx={0}
            onSampleIdxChange={() => {}}
            footnote="Structural preview — Gmail / Outlook / Apple Mail may render some details differently."
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

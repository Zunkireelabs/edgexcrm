"use client";

// Combines what the SMS precedent splits into cost-preview-dialog +
// send-confirm-dialog: email has no per-recipient cost to browse before
// deciding, so one dialog renders the full /preview response (audience,
// excluded breakdown, sender identity, cap warning, rendered samples) AND
// requires typing the exact recipient count to enable Send — the same "last
// line of defence" pattern as SMS's send-confirm-dialog.tsx.

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import type { EmailBlastPreviewResponse } from "../lib/types";

interface SendConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview: EmailBlastPreviewResponse | null;
  sending: boolean;
  error: string | null;
  onConfirm: () => void;
}

const EXCLUSION_LABELS: Record<keyof EmailBlastPreviewResponse["audience"]["excluded"], string> = {
  noEmail: "No email address",
  malformed: "Malformed address",
  suppressed: "On suppression list",
  duplicateEmail: "Duplicate address",
};

export function SendConfirmDialog({ open, onOpenChange, preview, sending, error, onConfirm }: SendConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const recipientCount = preview?.audience.sendable ?? 0;
  const matches = typed.trim() === String(recipientCount);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setTyped("");
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Confirm send</DialogTitle>
          <DialogDescription>This cannot be undone once emails start going out.</DialogDescription>
        </DialogHeader>

        {preview && (
          <div className="flex flex-col gap-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Audience matched</p>
                <p className="text-lg font-semibold tabular-nums">{preview.audience.matched}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Sendable</p>
                <p className="text-lg font-semibold tabular-nums">{preview.audience.sendable}</p>
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Excluded</p>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(EXCLUSION_LABELS) as (keyof typeof EXCLUSION_LABELS)[]).map((key) => (
                  <Badge key={key} variant="outline" className="text-xs font-normal">
                    {EXCLUSION_LABELS[key]}: {preview.audience.excluded[key]}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="rounded-md border p-3 flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Sending as</span>
                <span className="font-medium">{preview.sender.from}</span>
              </div>
              {preview.sender.replyTo && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Reply-to</span>
                  <span className="font-medium">{preview.sender.replyTo}</span>
                </div>
              )}
            </div>

            {preview.cap.willThrottle && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-800">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  This audience ({preview.audience.sendable}) exceeds today&apos;s remaining send capacity ({preview.cap.remaining} of{" "}
                  {preview.cap.dailyCap}/day, {preview.cap.sentToday} already sent today). The first {preview.cap.remaining} will send now;
                  the remaining {preview.cap.overCapBy} will send automatically once the cap resets, shown as &ldquo;Throttled&rdquo; on the
                  blast until it completes.
                </span>
              </div>
            )}

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Sample messages</p>
              <div className="flex flex-col gap-2">
                {preview.samples.map((s, i) => (
                  <div key={i} className="rounded-md bg-muted p-2 text-xs">
                    <p className="font-medium mb-1">{s.subject}</p>
                    <div className="prose prose-xs max-w-none" dangerouslySetInnerHTML={{ __html: s.bodyHtml }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirm-count">
            Type <span className="font-semibold tabular-nums">{recipientCount}</span> to confirm
          </Label>
          <Input
            id="confirm-count"
            inputMode="numeric"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={String(recipientCount)}
            autoComplete="off"
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!matches || sending || recipientCount === 0} onClick={onConfirm}>
            {sending ? "Sending…" : "Send now"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

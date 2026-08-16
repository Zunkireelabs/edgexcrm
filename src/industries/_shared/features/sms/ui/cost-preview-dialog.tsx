"use client";

// Renders POST /blasts/[id]/preview verbatim (SMS-PHASE3A-BRIEF.md §5) — every
// exclusion bucket broken out, credits per recipient, balance before/after,
// and the rendered samples. If insufficient, Send stays disabled and the
// shortfall is shown. If quiet hours defer the send, the tenant-local label
// is shown as-is — never a UTC timestamp.

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { smsSend, SmsApiError } from "../lib/api-client";
import type { SmsPreviewResponse } from "../lib/types";

interface CostPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blastId: string;
  body: string;
  onContinue: (preview: SmsPreviewResponse) => void;
}

const EXCLUSION_LABELS: Record<keyof SmsPreviewResponse["audience"]["excluded"], string> = {
  noPhone: "No phone number",
  foreignNumber: "Foreign number",
  malformed: "Malformed number",
  suppressed: "On suppression list",
  duplicatePhone: "Duplicate phone",
};

export function CostPreviewDialog({ open, onOpenChange, blastId, body, onContinue }: CostPreviewDialogProps) {
  const [preview, setPreview] = useState<SmsPreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // Loading must flip the instant the dialog opens, not one render behind.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    smsSend<SmsPreviewResponse>(`/api/v1/sms/blasts/${blastId}/preview`, "POST", { body })
      .then(setPreview)
      .catch((e: SmsApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, [open, blastId, body]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cost preview</DialogTitle>
          <DialogDescription>What this blast will actually cost and who it will reach.</DialogDescription>
        </DialogHeader>

        {loading && <div className="py-8 text-center text-sm text-muted-foreground">Calculating…</div>}
        {error && <div className="py-4 text-sm text-destructive">{error}</div>}

        {preview && !loading && (
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
                <span className="text-muted-foreground">Encoding</span>
                <Badge variant={preview.message.encoding === "unicode" ? "default" : "secondary"} className="text-xs">
                  {preview.message.encoding === "unicode" ? "Unicode" : "GSM-7"}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Credits per recipient</span>
                <span className="font-medium tabular-nums">
                  {preview.message.creditsPerRecipient}
                  {preview.message.personalized && <span className="text-muted-foreground font-normal"> (max across samples)</span>}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Total credits</span>
                <span className="font-semibold tabular-nums">{preview.cost.totalCredits}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Balance before / after</span>
                <span className="tabular-nums">
                  {preview.cost.balance} → {preview.cost.balanceAfter}
                </span>
              </div>
            </div>

            {!preview.cost.sufficient && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-destructive">
                Not enough credits — short by <strong>{preview.cost.shortfall}</strong>. Send is disabled until the balance is topped up.
              </div>
            )}

            {preview.timing.deferredByQuietHours && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-800">
                Outside quiet hours — will send at <strong>{preview.timing.localTimeLabel}</strong>.
              </div>
            )}

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Sample messages</p>
              <div className="flex flex-col gap-2">
                {preview.samples.map((s, i) => (
                  <p key={i} className="rounded-md bg-muted p-2 text-xs whitespace-pre-wrap font-mono">
                    {s}
                  </p>
                ))}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!preview || !preview.cost.sufficient || preview.audience.sendable === 0} onClick={() => preview && onContinue(preview)}>
            Continue to send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

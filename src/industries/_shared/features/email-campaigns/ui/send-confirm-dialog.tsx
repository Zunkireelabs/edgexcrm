"use client";

// Review & Send — the last screen before a blast goes out. The email preview
// is the primary content (clients review the rendered message here), so this
// is a large two-pane dialog: the rendered sample email fills the left pane in
// a sandboxed iframe (isolated CSS = renders like a real inbox, not fighting
// the app's styles), the send decision + "type the count to confirm" gate sit
// in a fixed right pane whose action buttons never scroll away. Below `lg` the
// panes stack (preview on top, actions pinned at the bottom).
//
// Same "type the exact recipient count to enable Send" guard as SMS's
// send-confirm-dialog.tsx; email additionally shows the full /preview response
// because there's no per-recipient cost to browse first.

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
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
  const [sampleIdx, setSampleIdx] = useState(0);

  // Reset the transient confirm state on every close — covers Cancel, Escape,
  // and overlay click (all routed through here).
  function handleOpenChange(next: boolean) {
    if (!next) {
      setTyped("");
      setSampleIdx(0);
    }
    onOpenChange(next);
  }

  const recipientCount = preview?.audience.sendable ?? 0;
  const matches = typed.trim() === String(recipientCount);

  const samples = preview?.samples ?? [];
  // Clamp on read so a freshly-built preview with fewer samples can never leave
  // the switcher pointing past the end (no effect / no reset needed).
  const clampedIdx = samples.length > 0 ? Math.min(sampleIdx, samples.length - 1) : 0;
  const activeSample = samples[clampedIdx];

  const shownExclusions = preview
    ? (Object.keys(EXCLUSION_LABELS) as (keyof typeof EXCLUSION_LABELS)[]).filter(
        (key) => preview.audience.excluded[key] > 0,
      )
    : [];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex h-[90vh] w-[95vw] max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="shrink-0 space-y-1 border-b px-6 py-4 text-left">
          <DialogTitle>Review &amp; send</DialogTitle>
          <DialogDescription>This cannot be undone once emails start going out.</DialogDescription>
        </DialogHeader>

        {!preview ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Preparing preview…</div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            {/* ── Preview pane (primary content) ───────────────────────── */}
            <section className="flex h-[46vh] shrink-0 flex-col border-b lg:h-auto lg:min-h-0 lg:flex-1 lg:border-b-0 lg:border-r">
              <div className="shrink-0 space-y-1 border-b bg-muted/30 px-4 py-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-muted-foreground">Preview</span>
                  {samples.length > 1 && (
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        disabled={clampedIdx === 0}
                        onClick={() => setSampleIdx(Math.max(0, clampedIdx - 1))}
                        aria-label="Previous sample"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </Button>
                      <span className="tabular-nums text-muted-foreground">
                        Sample {clampedIdx + 1} of {samples.length}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        disabled={clampedIdx >= samples.length - 1}
                        onClick={() => setSampleIdx(Math.min(samples.length - 1, clampedIdx + 1))}
                        aria-label="Next sample"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <span className="w-14 shrink-0 text-muted-foreground">Subject</span>
                  <span className="min-w-0 break-words font-medium">{activeSample?.subject || "—"}</span>
                </div>
                <div className="flex gap-2">
                  <span className="w-14 shrink-0 text-muted-foreground">From</span>
                  <span className="min-w-0 break-words">{preview.sender.from}</span>
                </div>
                {preview.sender.replyTo && (
                  <div className="flex gap-2">
                    <span className="w-14 shrink-0 text-muted-foreground">Reply-to</span>
                    <span className="min-w-0 break-words">{preview.sender.replyTo}</span>
                  </div>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-hidden bg-neutral-100 p-3 dark:bg-neutral-900">
                {activeSample ? (
                  <iframe
                    key={clampedIdx}
                    sandbox=""
                    srcDoc={activeSample.bodyHtml}
                    title={`Email preview — sample ${clampedIdx + 1}`}
                    className="mx-auto block h-full w-full max-w-[640px] rounded border bg-white shadow-sm"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    No preview available
                  </div>
                )}
              </div>

              <p className="shrink-0 border-t px-4 py-2 text-[11px] leading-snug text-muted-foreground">
                Structural preview — Gmail / Outlook / Apple Mail may render some CSS differently. Merge fields are
                filled from a real sendable recipient.
              </p>
            </section>

            {/* ── Decision pane (never scrolls away) ───────────────────── */}
            <aside className="flex min-h-0 flex-1 flex-col lg:w-[360px] lg:flex-none">
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">Sendable</p>
                    <p className="text-lg font-semibold tabular-nums">{preview.audience.sendable}</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">Matched</p>
                    <p className="text-lg font-semibold tabular-nums">{preview.audience.matched}</p>
                  </div>
                </div>

                {shownExclusions.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-muted-foreground">Excluded</p>
                    <div className="flex flex-wrap gap-1.5">
                      {shownExclusions.map((key) => (
                        <Badge key={key} variant="outline" className="text-xs font-normal">
                          {EXCLUSION_LABELS[key]}: {preview.audience.excluded[key]}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-1.5 rounded-md border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <span className="shrink-0 text-muted-foreground">Sending as</span>
                    <span className="min-w-0 break-words text-right font-medium">{preview.sender.from}</span>
                  </div>
                  {preview.sender.replyTo && (
                    <div className="flex items-start justify-between gap-3">
                      <span className="shrink-0 text-muted-foreground">Reply-to</span>
                      <span className="min-w-0 break-words text-right font-medium">{preview.sender.replyTo}</span>
                    </div>
                  )}
                </div>

                {preview.cap.willThrottle && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      This audience ({preview.audience.sendable}) exceeds today&apos;s remaining send capacity (
                      {preview.cap.remaining} of {preview.cap.dailyCap}/day, {preview.cap.sentToday} already sent today).
                      The first {preview.cap.remaining} will send now; the remaining {preview.cap.overCapBy} will send
                      automatically once the cap resets, shown as &ldquo;Throttled&rdquo; on the blast until it completes.
                    </span>
                  </div>
                )}
              </div>

              <div className="shrink-0 space-y-3 border-t p-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="confirm-count" className="text-xs">
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

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={sending}>
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={!matches || sending || recipientCount === 0}
                    onClick={onConfirm}
                  >
                    {sending ? "Sending…" : "Send now"}
                  </Button>
                </div>
              </div>
            </aside>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

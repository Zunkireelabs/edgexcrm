"use client";

// Shared rendering for an EmailBlastPreviewResponse sample: subject/from/
// reply-to header + the HTML body in a sandboxed iframe (isolated CSS = looks
// like a real inbox, not fighting the app's styles), with a sample pager when
// more than one sample came back. Extracted from send-confirm-dialog.tsx so
// blast-content-preview-dialog.tsx (read-only "what did we send" view) can
// reuse the exact same look without duplicating the iframe/pager logic.

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EmailBlastPreviewResponse } from "../lib/types";

interface EmailPreviewPaneProps {
  preview: EmailBlastPreviewResponse;
  sampleIdx: number;
  onSampleIdxChange: (idx: number) => void;
}

export function EmailPreviewPane({ preview, sampleIdx, onSampleIdxChange }: EmailPreviewPaneProps) {
  const samples = preview.samples;
  // Clamp on read so a freshly-built preview with fewer samples can never
  // leave the switcher pointing past the end (no effect / no reset needed).
  const clampedIdx = samples.length > 0 ? Math.min(sampleIdx, samples.length - 1) : 0;
  const activeSample = samples[clampedIdx];

  return (
    <div className="flex h-full flex-col">
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
                onClick={() => onSampleIdxChange(Math.max(0, clampedIdx - 1))}
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
                onClick={() => onSampleIdxChange(Math.min(samples.length - 1, clampedIdx + 1))}
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
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No preview available</div>
        )}
      </div>

      <p className="shrink-0 border-t px-4 py-2 text-[11px] leading-snug text-muted-foreground">
        Structural preview — Gmail / Outlook / Apple Mail may render some CSS differently. Merge fields are filled from a
        real sendable recipient.
      </p>
    </div>
  );
}

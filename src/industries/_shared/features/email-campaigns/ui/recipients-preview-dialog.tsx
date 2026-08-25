"use client";

// Renders POST /email-blasts/[id]/audience-preview — a paginated table of
// the exact leads a filter matches. Mirrors
// sms/ui/recipients-preview-dialog.tsx's fetch-on-open pattern.

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { emailBlastSend, EmailBlastApiError } from "../lib/api-client";
import type { EmailBlastAudiencePreviewResponse } from "../lib/types";
import type { FilterTree } from "@/lib/filters/types";

interface RecipientsPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blastId: string;
  audienceFilter: FilterTree;
}

const PAGE_SIZE = 25;

export function RecipientsPreviewDialog({ open, onOpenChange, blastId, audienceFilter }: RecipientsPreviewDialogProps) {
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState<EmailBlastAudiencePreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [open, audienceFilter]);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    emailBlastSend<EmailBlastAudiencePreviewResponse>(`/api/v1/email-blasts/${blastId}/audience-preview`, "POST", {
      audience_filter: audienceFilter,
      page,
      pageSize: PAGE_SIZE,
    })
      .then(setPreview)
      .catch((e: EmailBlastApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, [open, blastId, audienceFilter, page]);

  const totalPages = preview ? Math.max(1, Math.ceil(preview.total / preview.pageSize)) : 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Preview recipients</DialogTitle>
          <DialogDescription>Who this filter matches — the leads this blast will reach.</DialogDescription>
        </DialogHeader>

        {loading && <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>}
        {error && <div className="py-4 text-sm text-destructive">{error}</div>}

        {preview && !loading && preview.rows.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">No recipients match this filter.</div>
        )}

        {preview && !loading && preview.rows.length > 0 && (
          <div className="flex flex-col gap-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.rows.map((row) => (
                  <TableRow key={row.leadId}>
                    <TableCell>{row.name}</TableCell>
                    <TableCell>{row.email}</TableCell>
                    <TableCell>{row.source ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground">
              Page {preview.page} of {totalPages} — {preview.total} total sendable recipients.
            </p>
          </div>
        )}

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Prev
            </Button>
            <Button variant="outline" size="sm" disabled={!preview || page >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

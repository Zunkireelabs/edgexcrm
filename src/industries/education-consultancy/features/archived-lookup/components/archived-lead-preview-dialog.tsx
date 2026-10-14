"use client";

import { useState } from "react";
import Link from "next/link";
import { Archive, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/date";
import { failureMessage } from "@/lib/permission-denied";
import { archivedLeadName, type ArchivedLeadPreview } from "../lib/types";

// The small panel opened from Global Search for an archived lead: who it is, why/when it was archived, who it belongs to,
// and the "Move back to pipeline" action. It is a SUMMARY only — the full lead page (notes, documents, activity) keeps
// its own access rules; "Open lead" shows only when this user may open it.

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words font-medium text-foreground">{children}</dd>
    </div>
  );
}

export function ArchivedLeadPreviewDialog({
  lead,
  onClose,
  onRestored,
}: {
  lead: ArchivedLeadPreview | null;
  onClose: () => void;
  /** Called after a successful restore, so the caller can drop the lead from its results and refresh the page. */
  onRestored: (leadId: string) => void;
}) {
  const [restoring, setRestoring] = useState(false);

  async function restore() {
    if (!lead) return;
    setRestoring(true);
    try {
      const res = await fetch(`/api/v1/archived-leads/${lead.id}/restore`, { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        // 403 → the standard "no permission, contact admin"; otherwise the server's own reason (409 / 422 explain themselves).
        toast.error(res.status === 403 ? failureMessage(res, "") : (j?.error?.message ?? "Failed to move the lead back to the pipeline"));
        return;
      }
      const j = await res.json();
      toast.success(`${archivedLeadName(lead)} moved back to ${j?.data?.list_name ?? "the pipeline"}`);
      onRestored(lead.id);
      onClose();
    } catch {
      toast.error("Failed to move the lead back to the pipeline");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <Dialog open={!!lead} onOpenChange={(open) => !open && !restoring && onClose()}>
      <DialogContent className="sm:max-w-md">
        {lead && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span className="truncate">{archivedLeadName(lead)}</span>
                <Badge variant="secondary" className="shrink-0 gap-1">
                  <Archive className="h-3 w-3" />
                  Archived
                </Badge>
              </DialogTitle>
              <DialogDescription>
                This lead is in Archive. Send it back to the pipeline to work on it again.
              </DialogDescription>
            </DialogHeader>

            <dl className="space-y-2.5 py-1">
              {lead.email && <Row label="Email">{lead.email}</Row>}
              {lead.phone && <Row label="Phone">{lead.phone}</Row>}
              <Row label="Assigned to">{lead.assigned_to_name ?? "Unassigned"}</Row>
              <Row label="Archived from">{lead.archived_from_list_name ?? "—"}</Row>
              <Row label="Reason">{lead.archive_reason?.trim() || "No reason recorded"}</Row>
              <Row label="Archived on">{lead.archived_at ? formatDateTime(lead.archived_at) : "—"}</Row>
            </dl>

            {lead.can_restore && (
              <p className="text-xs text-muted-foreground">
                It goes back to {lead.archived_from_list_name ?? "the first stage"}
                {lead.assigned_to_name ? ` and stays with ${lead.assigned_to_name}` : ""}.
              </p>
            )}

            <DialogFooter className="gap-2 sm:gap-2">
              {lead.can_open && (
                <Button variant="outline" asChild disabled={restoring}>
                  <Link href={`/leads/${lead.id}`} onClick={onClose}>
                    Open lead
                  </Link>
                </Button>
              )}
              {lead.can_restore ? (
                <Button onClick={restore} disabled={restoring}>
                  {restoring ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                  Move back to pipeline
                </Button>
              ) : (
                <p className="self-center text-xs text-muted-foreground">
                  You can view this lead but not move it. Contact your admin.
                </p>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

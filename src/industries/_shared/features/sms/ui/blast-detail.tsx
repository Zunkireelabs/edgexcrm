"use client";

// Blast detail — status pill, aggregate counts, per-recipient rows including
// `suppressed` and `failed` with the provider's reason (SMS-PHASE3B-BRIEF.md §4).
// Polls while queued/sending so Send's caller lands on a live view.

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { smsSend, SmsApiError } from "../lib/api-client";
import type { SmsBlastRow, SmsBlastStatus } from "../lib/types";

interface BlastDetailProps {
  blast: SmsBlastRow;
  canSendSms: boolean;
  onRefresh: () => void;
}

const STATUS_BADGE: Record<SmsBlastStatus, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  scheduled: "secondary",
  queued: "secondary",
  sending: "default",
  sent: "default",
  partially_failed: "destructive",
  failed: "destructive",
  cancelled: "outline",
};

const POLLING_STATUSES = new Set<SmsBlastStatus>(["queued", "sending", "scheduled"]);
const CANCELLABLE_STATUSES = new Set<SmsBlastStatus>(["scheduled", "queued", "sending"]);
const POLL_INTERVAL_MS = 4000;

export function BlastDetail({ blast, canSendSms, onRefresh }: BlastDetailProps) {
  const [cancelling, setCancelling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!POLLING_STATUSES.has(blast.status)) return;
    pollRef.current = setInterval(onRefresh, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [blast.status, onRefresh]);

  async function handleCancel() {
    setCancelling(true);
    try {
      await smsSend(`/api/v1/sms/blasts/${blast.id}/cancel`, "POST");
      toast.success("Blast cancelled.");
      onRefresh();
    } catch (e) {
      toast.error(e instanceof SmsApiError ? e.message : "Failed to cancel blast.");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{blast.name}</h1>
            <Badge variant={STATUS_BADGE[blast.status]}>{blast.status.replace(/_/g, " ")}</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap max-w-xl">{blast.body}</p>
        </div>
        {canSendSms && CANCELLABLE_STATUSES.has(blast.status) && (
          <Button variant="destructive" onClick={handleCancel} disabled={cancelling}>
            {cancelling ? "Cancelling…" : "Cancel blast"}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">Total</p>
          <p className="text-lg font-semibold tabular-nums">{blast.recipients_total}</p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">Sent</p>
          <p className="text-lg font-semibold tabular-nums">{blast.recipients_sent}</p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">Failed</p>
          <p className="text-lg font-semibold tabular-nums">{blast.recipients_failed}</p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">Suppressed</p>
          <p className="text-lg font-semibold tabular-nums">{blast.recipients_suppressed}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <span className="text-muted-foreground">Estimated credits </span>
          <span className="tabular-nums font-medium">{blast.estimated_credits ?? "—"}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Reserved </span>
          <span className="tabular-nums font-medium">{blast.reserved_credits ?? "—"}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Actual </span>
          <span className="tabular-nums font-medium">{blast.actual_credits ?? "—"}</span>
        </div>
      </div>

      <div>
        <p className="text-sm font-medium mb-2">Recipients</p>
        {/* SMS-PHASE3B-BRIEF.md §4 asks for "per-recipient rows with their real
            status, including suppressed and failed with the provider's reason."
            The 3A API surface (docs/SMS-PHASE3A-BRIEF.md §4) has no GET route
            that lists sms_messages rows for a blast — only the aggregate counters
            on sms_blasts itself are reachable from any merged endpoint. Per the
            brief's own instruction not to invent an endpoint, this view shows
            the aggregate counts above and stops there; the missing route is
            called out explicitly in the PR report as a 3A contract gap for 3C. */}
        <p className="text-sm text-muted-foreground py-6 text-center max-w-lg mx-auto">
          Per-recipient rows aren&apos;t available yet — the 3A API has no endpoint that lists
          individual sms_messages rows for a blast (only the aggregate counters above). See the PR
          report: this needs a small follow-up route, not invented here.
        </p>
      </div>
    </div>
  );
}

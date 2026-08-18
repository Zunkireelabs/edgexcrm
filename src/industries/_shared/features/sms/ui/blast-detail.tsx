"use client";

// Blast detail — status pill, aggregate counts, per-recipient rows including
// `suppressed` and `failed` with the provider's reason (SMS-PHASE3B-BRIEF.md §4).
// Polls while queued/sending so Send's caller lands on a live view.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { smsGet, smsSend, SmsApiError } from "../lib/api-client";
import type { SmsBlastRecipientRow, SmsBlastRow, SmsBlastStatus } from "../lib/types";

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
const RECIPIENTS_PAGE_SIZE = 50;

const RECIPIENT_STATUS_BADGE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  queued: "outline",
  deferred: "outline",
  sending: "secondary",
  submitted: "secondary",
  delivered: "default",
  failed: "destructive",
  suppressed: "outline",
  cancelled: "outline",
};

export function BlastDetail({ blast, canSendSms, onRefresh }: BlastDetailProps) {
  const [cancelling, setCancelling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [recipients, setRecipients] = useState<SmsBlastRecipientRow[]>([]);
  const [recipientsPage, setRecipientsPage] = useState(1);
  const [recipientsTotalPages, setRecipientsTotalPages] = useState(1);
  const [recipientsLoading, setRecipientsLoading] = useState(false);

  const loadRecipients = useCallback(
    async (page: number) => {
      setRecipientsLoading(true);
      try {
        const { data, meta } = await smsGet<SmsBlastRecipientRow[]>(
          `/api/v1/sms/blasts/${blast.id}/messages?page=${page}&pageSize=${RECIPIENTS_PAGE_SIZE}`
        );
        setRecipients(data);
        setRecipientsTotalPages(meta?.totalPages ?? 1);
      } catch (e) {
        toast.error(e instanceof SmsApiError ? e.message : "Failed to load recipients.");
      } finally {
        setRecipientsLoading(false);
      }
    },
    [blast.id]
  );

  useEffect(() => {
    loadRecipients(recipientsPage);
    // blast.id changing (navigating to a different blast) resets to page 1 via the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipientsPage, blast.id]);

  useEffect(() => {
    setRecipientsPage(1);
  }, [blast.id]);

  useEffect(() => {
    if (!POLLING_STATUSES.has(blast.status)) return;
    pollRef.current = setInterval(() => {
      onRefresh();
      loadRecipients(recipientsPage);
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [blast.status, onRefresh, loadRecipients, recipientsPage]);

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
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium">Recipients</p>
          {recipientsTotalPages > 1 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Button
                variant="outline"
                size="sm"
                disabled={recipientsPage <= 1 || recipientsLoading}
                onClick={() => setRecipientsPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span>
                Page {recipientsPage} of {recipientsTotalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={recipientsPage >= recipientsTotalPages || recipientsLoading}
                onClick={() => setRecipientsPage((p) => Math.min(recipientsTotalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          )}
        </div>

        {recipientsLoading && recipients.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Loading recipients…</p>
        ) : recipients.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No recipients materialized for this blast yet.</p>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Phone</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Network</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                  <th className="px-3 py-2 font-medium">Delivered at</th>
                </tr>
              </thead>
              <tbody>
                {recipients.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="px-3 py-2 tabular-nums">{r.to_phone}</td>
                    <td className="px-3 py-2">
                      <Badge variant={RECIPIENT_STATUS_BADGE[r.status] ?? "outline"}>{r.status.replace(/_/g, " ")}</Badge>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{r.provider_network ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.error_message ?? r.error_code ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {r.delivered_at ? new Date(r.delivered_at).toLocaleString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

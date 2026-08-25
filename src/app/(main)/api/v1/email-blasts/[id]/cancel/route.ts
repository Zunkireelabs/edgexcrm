import { NextRequest } from "next/server";
import { requireEmailCampaignsAccess } from "@/lib/email/outbound/api-guard";
import { apiSuccess, apiNotFound, apiConflict, apiServiceUnavailable } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface BlastRow {
  id: string;
  status: string;
}

const CANCELLABLE_STATUSES = new Set(["scheduled", "queued", "sending", "throttled"]);

// POST /api/v1/email-blasts/[id]/cancel — mirrors sms/blasts/[id]/cancel's
// cancel-then-let-the-worker-notice shape, minus the credit settle step (no
// per-send provider cost to reconcile for email). Cancels remaining
// queued email_messages rows for this blast; safe to race against the worker
// — finalizeEmailBlast (email-blast-send.ts) must never transition a blast
// OUT of 'cancelled' once this route has set it (F-1 in the SMS precedent).
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/email-blasts/[id]/cancel" });

  const guard = await requireEmailCampaignsAccess();
  if (!guard.ok) return guard.response;
  const { db } = guard;
  const { id } = await params;

  const { data: blast, error: fetchError } = await db.from("email_blasts").select("id, status").eq("id", id).maybeSingle();
  if (fetchError || !blast) return apiNotFound("Email blast");
  const blastRow = blast as unknown as BlastRow;

  if (!CANCELLABLE_STATUSES.has(blastRow.status)) {
    return apiConflict(`Blast is "${blastRow.status}" — only scheduled/queued/sending/throttled blasts can be cancelled`);
  }

  const { error: messagesError } = await db
    .from("email_messages")
    .update({ status: "cancelled" })
    .eq("source", "blast")
    .eq("source_id", id)
    .eq("status", "queued");
  if (messagesError) {
    log.error({ err: messagesError, blastId: id }, "Failed to cancel pending email_messages rows");
    return apiServiceUnavailable("Failed to cancel pending messages");
  }

  const { data: updated, error: updateError } = await db
    .from("email_blasts")
    .update({ status: "cancelled", completed_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (updateError) {
    log.error({ err: updateError, blastId: id }, "Failed to mark blast cancelled");
    return apiServiceUnavailable("Failed to cancel blast");
  }

  return apiSuccess(updated);
}

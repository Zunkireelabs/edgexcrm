import { NextRequest } from "next/server";
import { requireSmsAccess } from "@/lib/sms/api-guard";
import { apiSuccess, apiNotFound, apiConflict, apiServiceUnavailable } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface BlastRow {
  id: string;
  status: string;
}

const CANCELLABLE_STATUSES = new Set(["scheduled", "queued", "sending"]);

// POST /api/v1/sms/blasts/[id]/cancel — cancels remaining queued/deferred
// sms_messages rows; already-submitted/sent messages are untouched (SMS-PHASE3A-BRIEF.md §4).
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/sms/blasts/[id]/cancel" });

  const guard = await requireSmsAccess({ requireSend: true });
  if (!guard.ok) return guard.response;
  const { db } = guard;
  const { id } = await params;

  const { data: blast, error: fetchError } = await db.from("sms_blasts").select("id, status").eq("id", id).maybeSingle();
  if (fetchError || !blast) return apiNotFound("SMS blast");
  const blastRow = blast as unknown as BlastRow;

  if (!CANCELLABLE_STATUSES.has(blastRow.status)) {
    return apiConflict(`Blast is "${blastRow.status}" — only scheduled/queued/sending blasts can be cancelled`);
  }

  const { error: messagesError } = await db
    .from("sms_messages")
    .update({ status: "cancelled" })
    .eq("blast_id", id)
    .in("status", ["queued", "deferred"]);
  if (messagesError) {
    log.error({ err: messagesError, blastId: id }, "Failed to cancel pending sms_messages rows");
    return apiServiceUnavailable("Failed to cancel pending messages");
  }

  const { data: updated, error: updateError } = await db
    .from("sms_blasts")
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

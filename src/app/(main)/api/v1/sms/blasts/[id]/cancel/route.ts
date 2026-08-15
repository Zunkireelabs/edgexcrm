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
  reserved_credits: number | null;
}

interface CreditRow {
  provider_credit: number | null;
}

const CANCELLABLE_STATUSES = new Set(["scheduled", "queued", "sending"]);

// POST /api/v1/sms/blasts/[id]/cancel — cancels remaining queued/deferred
// sms_messages rows and settles credits IMMEDIATELY (SMS-PHASE3A-FIXES-BRIEF.md
// F-2), rather than waiting for the Inngest run's own finalize step to get
// there — that step may be parked in step.sleepUntil for a scheduled send
// (holds credits for days) or, if the triggering event was never delivered,
// never runs at all (holds credits forever). sms_credits_settle is idempotent
// on ref_id, so whichever of this route / finalizeBlast settles first wins
// and the other is a safe no-op — see docs/SMS-PHASE3A-FIXES-BRIEF.md.
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/sms/blasts/[id]/cancel" });

  const guard = await requireSmsAccess({ requireSend: true });
  if (!guard.ok) return guard.response;
  const { db } = guard;
  const { id } = await params;

  const { data: blast, error: fetchError } = await db
    .from("sms_blasts")
    .select("id, status, reserved_credits")
    .eq("id", id)
    .maybeSingle();
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

  // actual = what the provider has ALREADY charged for this blast, not 0 —
  // settling at 0 after some messages went out would refund credits we
  // really spent.
  const { data: chargedRows, error: chargedError } = await db
    .from("sms_messages")
    .select("provider_credit")
    .eq("blast_id", id)
    .in("status", ["submitted", "delivered"]);
  if (chargedError) {
    log.error({ err: chargedError, blastId: id }, "Failed to total already-charged sms credits");
    return apiServiceUnavailable("Failed to total charged credits");
  }
  const actualCredits = ((chargedRows ?? []) as unknown as CreditRow[]).reduce((sum, r) => sum + (r.provider_credit ?? 0), 0);

  const { error: settleError } = await db.rpc("sms_credits_settle", {
    p_ref_id: id,
    p_reserved: blastRow.reserved_credits ?? 0,
    p_actual: actualCredits,
    p_ref_type: "sms_blast",
  });
  if (settleError) {
    log.error({ err: settleError, blastId: id }, "sms_credits_settle failed on cancel");
    return apiServiceUnavailable("Failed to settle SMS credits");
  }

  const { data: updated, error: updateError } = await db
    .from("sms_blasts")
    .update({ status: "cancelled", actual_credits: actualCredits, completed_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (updateError) {
    log.error({ err: updateError, blastId: id }, "Failed to mark blast cancelled");
    return apiServiceUnavailable("Failed to cancel blast");
  }

  return apiSuccess(updated);
}

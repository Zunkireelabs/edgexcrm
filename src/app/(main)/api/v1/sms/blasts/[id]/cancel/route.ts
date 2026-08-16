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
// sms_messages rows. Whether it also settles immediately depends on the
// blast's status (SMS-PHASE3A-FIX-F5-BRIEF.md):
//
//   scheduled/queued -> settle immediately. No batch can be running (the
//   Inngest run is either parked in step.sleepUntil or never fired), so a
//   sum(provider_credit) snapshot taken here is accurate. Without this,
//   credits sit reserved for days (scheduled) or forever (undelivered
//   event) — that's the case F-2 was written for.
//
//   sending -> do NOT settle here. A send-batch-N step may be running RIGHT
//   NOW and submit more messages to the provider after our snapshot is
//   taken; because sms_credits_settle is idempotent on ref_id, settling
//   early here would make finalizeBlast's later (correct, complete) settle
//   a no-op and permanently undercharge the ledger vs. what the provider
//   actually billed (F-5). finalizeBlast reaches its own settle step within
//   seconds of the batch loop noticing the cancelled rows, and F-1
//   guarantees it will not transition the blast out of 'cancelled'.
//
// Do not collapse this back into one unconditional settle call.
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/sms/blasts/[id]/cancel" });

  const guard = await requireSmsAccess();
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

  // 'sending' means a send-batch-N Inngest step may be running RIGHT NOW and
  // submitting more messages after we've taken our snapshot below — settling
  // here would undercharge the ledger (F-5). Only scheduled/queued blasts are
  // safe to settle immediately: no batch can be in flight for those.
  const settleNow = blastRow.status !== "sending";

  let blastUpdate: Record<string, unknown> = { status: "cancelled" };

  if (settleNow) {
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

    blastUpdate = { ...blastUpdate, actual_credits: actualCredits, completed_at: new Date().toISOString() };
  }
  // else: leave settling to finalizeBlast, which reaches it within seconds of
  // the batch loop noticing the cancelled rows, with the true total charged.

  const { data: updated, error: updateError } = await db
    .from("sms_blasts")
    .update(blastUpdate)
    .eq("id", id)
    .select("*")
    .single();
  if (updateError) {
    log.error({ err: updateError, blastId: id }, "Failed to mark blast cancelled");
    return apiServiceUnavailable("Failed to cancel blast");
  }

  return apiSuccess(updated);
}

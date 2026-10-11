import { emitEvent } from "@/lib/api/audit";
import { logger } from "@/lib/logger";
import type { ScopedClient } from "@/lib/supabase/scoped";

// A lead's phone number just landed on the SMS do-not-contact list (opt-out link, or found there at send time). Nothing
// can be texted to it again, so the lead's running SMS sequence ENDS now (stop_reason 'suppressed'). Only the SMS channel:
// an SMS opt-out says nothing about email, and (the twin of this file) an email unsubscribe leaves SMS alone too.
// Idempotent: only running (active / paused) SMS enrollments are touched.

export async function stopSmsEnrollmentsForLead(
  db: ScopedClient,
  params: { tenantId: string; leadId: string; reason: string }
): Promise<{ ended: number }> {
  const { data: enrollments, error } = await db
    .from("sequence_enrollments")
    .select("id, sequence_id")
    .eq("lead_id", params.leadId)
    .eq("channel", "sms")
    .in("status", ["active", "paused"]);
  if (error) {
    logger.error({ err: error, tenantId: params.tenantId }, "stopSmsEnrollmentsForLead: failed to load enrollments");
    return { ended: 0 };
  }

  let ended = 0;
  const nowIso = new Date().toISOString();
  for (const enrollment of (enrollments ?? []) as unknown as { id: string; sequence_id: string }[]) {
    try {
      const { data: changed, error: updateError } = await db
        .from("sequence_enrollments")
        .update({ status: "unenrolled", stop_reason: "suppressed", stopped_at: nowIso })
        .eq("id", enrollment.id)
        .in("status", ["active", "paused"])
        .select("id");
      if (updateError) throw updateError;
      if (!changed || changed.length === 0) continue; // someone ended it first

      await db.from("sequence_step_drafts").update({ status: "skipped" }).eq("enrollment_id", enrollment.id).eq("status", "pending");
      ended++;

      await emitEvent({
        tenantId: params.tenantId,
        type: "sequence.ended_suppressed",
        entityType: "sequence_enrollment",
        entityId: enrollment.id,
        payload: { sequence_id: enrollment.sequence_id, lead_id: params.leadId, reason: params.reason, channel: "sms" },
      });
    } catch (err) {
      logger.error({ err, enrollmentId: enrollment.id }, "stopSmsEnrollmentsForLead: failed to end an enrollment");
    }
  }

  // A sequence parked behind one of these ("Queue next") could never be texted either: cancel it.
  const { error: queueError } = await db
    .from("sequence_enrollment_queue")
    .update({ status: "cancelled", reason: "The number has opted out of SMS." })
    .eq("lead_id", params.leadId)
    .eq("channel", "sms")
    .eq("status", "waiting");
  if (queueError) {
    logger.error({ err: queueError, tenantId: params.tenantId }, "stopSmsEnrollmentsForLead: failed to cancel the SMS queue");
  }

  return { ended };
}

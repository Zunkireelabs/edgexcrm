import { emitEvent } from "@/lib/api/audit";
import { logger } from "@/lib/logger";
import type { ScopedClient } from "@/lib/supabase/scoped";

// An address just landed on the do-not-contact list (unsubscribe link, hard bounce, spam complaint — see
// suppressEmail in src/lib/email/outbound/suppression.ts). Nothing can ever be emailed to it again, so every sequence a
// lead with that address is running ENDS now (stop_reason 'suppressed', migration 262). Before this, the enrollment stayed
// active: each remaining step failed or sat pending, and the lead stayed locked out of any other sequence.
//
// Ends (does not pause): a suppressed address never becomes mailable again by itself, and a paused enrollment would keep the
// lead locked out forever. A queued "next" sequence for the lead is cancelled too — it could not be sent either.
// Idempotent: only running (active / paused) enrollments are touched, so calling it again for the same address is a no-op.

export interface SuppressionStopResult {
  leads: number;
  ended: number;
  queueCancelled: number;
}

const MAX_LEADS_PER_ADDRESS = 100;

/** Escapes LIKE wildcards so an address is matched literally (an underscore is common in real addresses). */
function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

interface EnrollmentRow {
  id: string;
  lead_id: string;
  sequence_id: string;
}

export async function stopEnrollmentsForSuppressedEmail(
  db: ScopedClient,
  params: { tenantId: string; email: string; leadId?: string | null; reason: string }
): Promise<SuppressionStopResult> {
  const result: SuppressionStopResult = { leads: 0, ended: 0, queueCancelled: 0 };
  const email = params.email.trim().toLowerCase();
  if (!email) return result;

  // Every lead that carries this address (case-insensitive) — twins included — plus the one we were told about.
  const leadIds = new Set<string>();
  if (params.leadId) leadIds.add(params.leadId);
  const { data: leads, error: leadsError } = await db
    .from("leads")
    .select("id")
    .ilike("email", likeLiteral(email))
    .limit(MAX_LEADS_PER_ADDRESS);
  if (leadsError) {
    logger.error({ err: leadsError, tenantId: params.tenantId }, "stopEnrollmentsForSuppressedEmail: failed to find leads");
    return result;
  }
  for (const row of (leads ?? []) as unknown as { id: string }[]) leadIds.add(row.id);
  if (leadIds.size === 0) return result;
  result.leads = leadIds.size;
  const ids = [...leadIds];

  const { data: enrollments, error: enrollError } = await db
    .from("sequence_enrollments")
    .select("id, lead_id, sequence_id")
    .in("lead_id", ids)
    .in("status", ["active", "paused"]);
  if (enrollError) {
    logger.error({ err: enrollError, tenantId: params.tenantId }, "stopEnrollmentsForSuppressedEmail: failed to load enrollments");
    return result;
  }

  const nowIso = new Date().toISOString();
  for (const enrollment of (enrollments ?? []) as unknown as EnrollmentRow[]) {
    try {
      const { data: changed, error } = await db
        .from("sequence_enrollments")
        .update({ status: "unenrolled", stop_reason: "suppressed", stopped_at: nowIso })
        .eq("id", enrollment.id)
        .in("status", ["active", "paused"])
        .select("id");
      if (error) throw error;
      if (!changed || changed.length === 0) continue; // someone ended it first

      await db
        .from("sequence_step_drafts")
        .update({ status: "skipped" })
        .eq("enrollment_id", enrollment.id)
        .eq("status", "pending");
      result.ended++;

      await emitEvent({
        tenantId: params.tenantId,
        type: "sequence.ended_suppressed",
        entityType: "sequence_enrollment",
        entityId: enrollment.id,
        payload: { sequence_id: enrollment.sequence_id, lead_id: enrollment.lead_id, reason: params.reason },
      });
    } catch (err) {
      logger.error({ err, enrollmentId: enrollment.id }, "stopEnrollmentsForSuppressedEmail: failed to end an enrollment");
    }
  }

  // a "queue next" sequence parked behind one of these leads can never be sent either
  const { data: cancelled } = await db
    .from("sequence_enrollment_queue")
    .update({ status: "cancelled", reason: "The address is on the do-not-contact list." })
    .in("lead_id", ids)
    .eq("status", "waiting")
    .select("id");
  result.queueCancelled = (cancelled ?? []).length;

  return result;
}

import { buildUserAuthContext } from "@/lib/api/auth";
import { logger } from "@/lib/logger";
import { scopedClientForTenant, type ScopedClient } from "@/lib/supabase/scoped";

// "Queue next" (migration 259): a lead can be in only ONE running sequence, so a second sequence is parked in
// sequence_enrollment_queue and started automatically when the lead's current enrollment ends (completes,
// unenrolled, or ended by a reply with on_reply='end'). One waiting row per lead (partial unique index).

export type QueueResult = "queued" | "already_queued";

export async function queueNextSequence(
  db: ScopedClient,
  params: { leadId: string; sequenceId: string; queuedBy: string; runId: string | null }
): Promise<QueueResult> {
  const { error } = await db.from("sequence_enrollment_queue").insert({
    lead_id: params.leadId,
    sequence_id: params.sequenceId,
    queued_by: params.queuedBy,
    run_id: params.runId,
    status: "waiting",
  });
  if (error) {
    if (error.code === "23505") return "already_queued";
    throw new Error(`queueNextSequence failed: ${error.message}`);
  }
  return "queued";
}

interface QueueRow {
  id: string;
  sequence_id: string;
  queued_by: string | null;
}

export type StartQueuedResult = "none" | "started" | "waiting" | "failed";

/**
 * Called after a lead's enrollment ended: starts the oldest waiting queued sequence for that lead, if any.
 * Never throws for an expected situation — a lead that is (again) in a sequence just keeps waiting, a queued
 * sequence that was archived / a starter who left is marked failed with a reason.
 */
export async function startQueuedEnrollment(tenantId: string, leadId: string): Promise<StartQueuedResult> {
  const db = await scopedClientForTenant(tenantId);

  const { data } = await db
    .from("sequence_enrollment_queue")
    .select("id, sequence_id, queued_by")
    .eq("lead_id", leadId)
    .eq("status", "waiting")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const row = data as unknown as QueueRow | null;
  if (!row) return "none";

  const fail = async (reason: string): Promise<StartQueuedResult> => {
    await db.from("sequence_enrollment_queue").update({ status: "failed", reason }).eq("id", row.id).eq("status", "waiting");
    return "failed";
  };

  const [{ data: seq }, { data: lead }] = await Promise.all([
    db.from("email_sequences").select("id, status").eq("id", row.sequence_id).maybeSingle(),
    db.from("leads").select("id, assigned_to, deleted_at").eq("id", leadId).maybeSingle(),
  ]);
  const sequence = seq as unknown as { status: string } | null;
  const leadRow = lead as unknown as { assigned_to: string | null; deleted_at: string | null } | null;
  if (!sequence || sequence.status !== "active") return fail("The queued sequence is no longer active.");
  if (!leadRow || leadRow.deleted_at) return fail("The lead was deleted.");

  const auth = row.queued_by ? await buildUserAuthContext(row.queued_by, tenantId) : null;
  if (!auth) return fail("The person who queued this no longer has access.");

  // dynamic: engine.ts calls back into this module when an enrollment ends (avoids an import cycle)
  const { enrollLead, EnrollmentConflictError } = await import("./engine");
  try {
    await enrollLead(db, auth, {
      sequenceId: row.sequence_id,
      leadId,
      assignedTo: leadRow.assigned_to ?? auth.userId,
      enrolledBy: auth.userId,
    });
  } catch (err) {
    // the lead is in another running sequence again — keep waiting for that one to end
    if (err instanceof EnrollmentConflictError) return "waiting";
    logger.error({ err, leadId, queueId: row.id }, "queue-next: failed to start the queued sequence");
    return fail((err instanceof Error ? err.message : String(err)).slice(0, 200));
  }

  await db
    .from("sequence_enrollment_queue")
    .update({ status: "started", started_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("status", "waiting");
  return "started";
}

/** Non-fatal wrapper for the places an enrollment ends: a failure here must never undo the end itself. */
export async function promoteQueuedEnrollment(tenantId: string, leadId: string): Promise<void> {
  try {
    await startQueuedEnrollment(tenantId, leadId);
  } catch (err) {
    logger.error({ err, tenantId, leadId }, "queue-next: promoting the queued sequence failed (non-fatal)");
  }
}

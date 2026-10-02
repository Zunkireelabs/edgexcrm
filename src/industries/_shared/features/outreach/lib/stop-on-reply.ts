import { emitEvent } from "@/lib/api/audit";
import { logger } from "@/lib/logger";
import type { ScopedClient } from "@/lib/supabase/scoped";

// A lead replied to us. What happens to the sequences they are running is decided per sequence
// (email_sequences.on_reply, migration 257):
//   pause    (default) freeze the enrollment — nothing sends while paused, a rep resumes or unenrolls
//   end      unenroll it and skip its pending drafts (same end state as the manual "unenroll")
//   continue ignore replies
//
// Called by the inbound-email processor for a genuine reply only — the auto-reply guard there
// (Auto-Submitted / Precedence / X-Autoreply / List-Id, dead-lettered before any write) means an
// out-of-office or bounce never reaches this function.
//
// Safe to call twice for the same reply: every update is guarded on status='active', so the
// second call finds nothing to change. It never touches an enrollment a person already paused (but it does
// record the reply on one the sequence-level "Pause all" froze, so "Resume all" skips that lead).

export type OnReply = "pause" | "end" | "continue";

export const ON_REPLY_VALUES: readonly OnReply[] = ["pause", "end", "continue"];

/** Anything unknown (older row, bad value) falls back to the safe default. */
export function normalizeOnReply(value: unknown): OnReply {
  return ON_REPLY_VALUES.includes(value as OnReply) ? (value as OnReply) : "pause";
}

export interface ReplyStopResult {
  paused: number;
  ended: number;
  kept: number;
}

interface ActiveEnrollmentRow {
  id: string;
  sequence_id: string;
  status: "active" | "paused";
  stop_reason: string | null;
}

interface SequenceOnReplyRow {
  id: string;
  on_reply: string | null;
}

export async function stopEnrollmentsOnReply(
  db: ScopedClient,
  params: { tenantId: string; leadId: string; emailId: string }
): Promise<ReplyStopResult> {
  const result: ReplyStopResult = { paused: 0, ended: 0, kept: 0 };

  const { data: enrollments, error } = await db
    .from("sequence_enrollments")
    .select("id, sequence_id, status, stop_reason")
    .eq("lead_id", params.leadId)
    .in("status", ["active", "paused"]);
  if (error) {
    logger.error({ err: error, leadId: params.leadId }, "stopEnrollmentsOnReply: failed to load enrollments");
    return result;
  }
  // Active ones, plus the ones the sequence-level "Pause all" froze: a reply must be recorded on those too, or
  // "Resume all" would later restart emails to someone who answered. A rep's own pause (stop_reason NULL) or an
  // earlier reply stop is left alone.
  const active = ((enrollments ?? []) as unknown as ActiveEnrollmentRow[]).filter(
    (e) => e.status === "active" || e.stop_reason === "sequence_paused"
  );
  if (active.length === 0) return result;

  const { data: sequences } = await db
    .from("email_sequences")
    .select("id, on_reply")
    .in("id", [...new Set(active.map((e) => e.sequence_id))]);
  const onReplyBySequence = new Map(
    ((sequences ?? []) as unknown as SequenceOnReplyRow[]).map((s) => [s.id, normalizeOnReply(s.on_reply)])
  );

  const nowIso = new Date().toISOString();

  for (const enrollment of active) {
    const action = onReplyBySequence.get(enrollment.sequence_id) ?? "pause";
    if (action === "continue") {
      result.kept++;
      continue;
    }

    try {
      // guarded on the state we read, so a person's change in between is never overwritten
      let update = db
        .from("sequence_enrollments")
        .update({
          status: action === "pause" ? "paused" : "unenrolled",
          stop_reason: "replied",
          stopped_at: nowIso,
        })
        .eq("id", enrollment.id)
        .eq("status", enrollment.status);
      if (enrollment.status === "paused") update = update.eq("stop_reason", "sequence_paused");
      const { data: changed, error: updateError } = await update.select("id");
      if (updateError) throw updateError;
      // Someone paused/ended it between our read and write — leave their decision alone.
      if (!changed || changed.length === 0) continue;

      if (action === "end") {
        await db
          .from("sequence_step_drafts")
          .update({ status: "skipped" })
          .eq("enrollment_id", enrollment.id)
          .eq("status", "pending");
        result.ended++;
        // the lead is free again — start a sequence queued behind this one, if any
        const { promoteQueuedEnrollment } = await import("./queue-next");
        await promoteQueuedEnrollment(params.tenantId, params.leadId);
      } else {
        result.paused++;
      }

      await emitEvent({
        tenantId: params.tenantId,
        type: action === "pause" ? "sequence.paused_on_reply" : "sequence.ended_on_reply",
        entityType: "sequence_enrollment",
        entityId: enrollment.id,
        payload: { sequence_id: enrollment.sequence_id, lead_id: params.leadId, email_id: params.emailId },
      });
    } catch (err) {
      logger.error({ err, enrollmentId: enrollment.id }, "stopEnrollmentsOnReply: failed to stop enrollment");
    }
  }

  return result;
}

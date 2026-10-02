import { createServiceClient } from "@/lib/supabase/server";
import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { logger } from "@/lib/logger";
import { isBulkEmailEnabledForTenant } from "./flag";
import { sendDraftViaEdgeX } from "@/industries/_shared/features/outreach/lib/send-draft";

// Sends sequence drafts a rep SCHEDULED ("Schedule send"). Deliberately NOT an Inngest function:
// the shared Inngest quota was exhausted once and silently blocked every blast, so — like
// blast-runner.ts — this is driven by an in-process timer (src/instrumentation.ts), with no
// outside scheduler. Due times live in the database, so a restart only delays a send, never loses it.
//
// Safe to run repeatedly or concurrently: sendDraftViaEdgeX upserts the email_messages row on
// (source_id, lead_id), so a draft can never be sent twice. The tenant's bulk-email grant is
// re-checked at fire time; if sending was turned off the schedule is cleared with a reason
// (never held back to fire unexpectedly later).

const MAX_DUE_PER_TENANT_PER_RUN = 50;

interface TenantIdRow {
  tenant_id: string;
}

interface ScheduledDraftRow {
  id: string;
  lead_id: string;
  subject: string;
  body_html: string;
  scheduled_by: string | null;
}

export interface ScheduleRunSummary {
  sent: number;
  throttled: number;
  cleared: number;
}

let running = false;

async function findTenantsWithDueScheduledDrafts(): Promise<string[]> {
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("sequence_step_drafts")
    .select("tenant_id")
    .eq("status", "pending")
    .not("scheduled_send_at", "is", null)
    .lte("scheduled_send_at", new Date().toISOString())
    .limit(2000);
  if (error) {
    logger.error({ err: error }, "sequence-schedule-runner: failed to scan for due scheduled drafts");
    throw error;
  }
  return [...new Set(((data ?? []) as unknown as TenantIdRow[]).map((r) => r.tenant_id))];
}

export async function processTenantScheduledDrafts(tenantId: string): Promise<ScheduleRunSummary> {
  const summary: ScheduleRunSummary = { sent: 0, throttled: 0, cleared: 0 };
  const db = await scopedClientForTenant(tenantId);
  const nowIso = new Date().toISOString();

  // Same eligibility as the Today list: a soft-deleted lead or a paused/completed/unenrolled
  // enrollment never sends.
  const { data, error } = await db
    .from("sequence_step_drafts")
    .select("id, lead_id, subject, body_html, scheduled_by, leads!inner(deleted_at), sequence_enrollments!inner(status)")
    .eq("status", "pending")
    .not("scheduled_send_at", "is", null)
    .lte("scheduled_send_at", nowIso)
    .is("leads.deleted_at", null)
    .eq("sequence_enrollments.status", "active")
    .order("scheduled_send_at", { ascending: true })
    .limit(MAX_DUE_PER_TENANT_PER_RUN);
  if (error) {
    logger.error({ err: error, tenantId }, "sequence-schedule-runner: failed to load due scheduled drafts");
    throw error;
  }
  const drafts = (data ?? []) as unknown as ScheduledDraftRow[];
  if (drafts.length === 0) return summary;

  const clearSchedule = async (draftId: string, reason: string) => {
    await db
      .from("sequence_step_drafts")
      .update({ scheduled_send_at: null, scheduled_error: reason })
      .eq("id", draftId);
    summary.cleared++;
  };

  const sendingEnabled = await isBulkEmailEnabledForTenant(tenantId);

  for (const draft of drafts) {
    if (!sendingEnabled) {
      await clearSchedule(draft.id, "Sending from EdgeX was turned off when this was due, so it was not sent.");
      continue;
    }
    if (!draft.subject?.trim()) {
      await clearSchedule(draft.id, "The subject was blank when this was due, so it was not sent.");
      continue;
    }

    const result = await sendDraftViaEdgeX(db, tenantId, draft, { sentBy: draft.scheduled_by, scheduled: true });

    switch (result.status) {
      case "sent":
      case "already_sent":
        summary.sent++;
        break;
      case "throttled":
        // Daily cap reached: stays scheduled and is retried on the next pass.
        summary.throttled++;
        break;
      case "no_email":
        await clearSchedule(draft.id, "This lead has no email address, so it was not sent.");
        break;
      case "already_handled":
        await clearSchedule(
          draft.id,
          result.errorMessage ?? `A previous send attempt ended as "${result.messageStatus}", so it was not sent again.`
        );
        break;
      case "failed":
        await clearSchedule(
          draft.id,
          result.suppressed
            ? "This address has unsubscribed or bounced, so EdgeX did not send to it."
            : (result.errorMessage ?? "The email couldn't be sent.")
        );
        break;
    }
  }

  return summary;
}

// One pass over every tenant with a due scheduled draft. The module-level guard stops two passes
// overlapping inside this process; the idempotent upsert covers a second process.
export async function runScheduledSequenceSends(): Promise<Record<string, ScheduleRunSummary>> {
  if (running) return {};
  running = true;
  const results: Record<string, ScheduleRunSummary> = {};
  try {
    for (const tenantId of await findTenantsWithDueScheduledDrafts()) {
      try {
        results[tenantId] = await processTenantScheduledDrafts(tenantId);
      } catch (err) {
        logger.error({ err, tenantId }, "sequence-schedule-runner: tenant pass threw");
      }
    }
    return results;
  } finally {
    running = false;
  }
}

import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { createNotification, NotificationTypes } from "@/lib/notifications";

// Cross-tenant service-role scans (a background cron has no single tenant). This module lives
// under src/lib/inngest/ — NOT src/lib/ai/ — so it is outside the createServiceClient ESLint ban;
// createServiceClient is the correct client for a cross-tenant job. Presence of due rows is the
// scope (feature-gated upstream at creation time), same justification as the original route.

// Due = remind_at passed, not yet fired, task incomplete, parent lead live.
// Throws on a failed SELECT (fail-closed) so the caller can surface failure (route → non-200;
// Inngest step → retry). Per-item notify failures are swallowed + retried next run.
export async function runTaskReminders(): Promise<{ processed: number; notified: number }> {
  const supabase = await createServiceClient();
  const nowIso = new Date().toISOString();

  const { data: due, error } = await supabase
    .from("lead_checklists")
    .select("id, lead_id, tenant_id, title, leads!inner(assigned_to, deleted_at)")
    .lte("remind_at", nowIso)
    .is("reminded_at", null)
    .eq("is_completed", false)
    .is("leads.deleted_at", null)
    .limit(500);

  if (error) {
    logger.error({ err: error }, "reminders run: failed to fetch due reminders");
    throw error;
  }

  let notified = 0;
  const processedIds: string[] = [];

  for (const row of due ?? []) {
    const lead = row.leads as unknown as { assigned_to: string | null };
    if (!lead?.assigned_to) {
      // No assignee — stamp to avoid perpetual re-scan, no notification needed.
      processedIds.push(row.id);
      continue;
    }
    try {
      await createNotification({
        tenantId: row.tenant_id,
        userId: lead.assigned_to,
        type: NotificationTypes.TASK_REMINDER,
        title: "Task reminder",
        message: row.title,
        link: `/leads/${row.lead_id}`,
      });
      notified++;
      processedIds.push(row.id); // stamp only after confirmed delivery
    } catch (err) {
      logger.error({ err, checklistId: row.id }, "reminders run: failed to notify");
      // Row NOT stamped — will be retried on the next run.
    }
  }

  // Stamp all due rows as fired (even un-assigned ones) so they aren't re-scanned forever.
  if (processedIds.length > 0) {
    const { error: stampErr } = await supabase
      .from("lead_checklists")
      .update({ reminded_at: nowIso })
      .in("id", processedIds);
    if (stampErr) {
      logger.error({ err: stampErr }, "reminders run: failed to stamp reminded_at");
    }
  }

  logger.info({ processed: processedIds.length, notified }, "task reminders run complete");
  return { processed: processedIds.length, notified };
}

// Outreach drafts that just came due. Notify the draft's owner (assigned_to) once, when a
// pending draft on an ACTIVE enrollment passes its due_at. notified_at is the fire-once stamp.
//
// No feature-gate here: this cron is cross-tenant service-role, and sequence_step_drafts only
// exist for tenants that used the OUTREACH feature (gated at enrollment creation). Presence of
// rows IS the scope.
export async function runOutreachDraftReminders(): Promise<{ processed: number; notified: number }> {
  const supabase = await createServiceClient();
  const nowIso = new Date().toISOString();

  const { data: dueDrafts, error: draftErr } = await supabase
    .from("sequence_step_drafts")
    .select("id, lead_id, tenant_id, assigned_to, subject, sequence_enrollments!inner(status), leads!inner(deleted_at)")
    .lte("due_at", nowIso)
    .is("notified_at", null)
    .eq("status", "pending")
    .eq("sequence_enrollments.status", "active")
    .is("leads.deleted_at", null)
    .limit(500);

  if (draftErr) {
    logger.error({ err: draftErr }, "reminders run: failed to fetch due outreach drafts");
    throw draftErr;
  }

  let outreachNotified = 0;
  const draftProcessedIds: string[] = [];

  for (const row of dueDrafts ?? []) {
    const r = row as unknown as { id: string; lead_id: string; tenant_id: string; assigned_to: string | null; subject: string | null };
    if (!r.assigned_to) {
      draftProcessedIds.push(r.id); // no owner — stamp to avoid perpetual re-scan
      continue;
    }
    try {
      await createNotification({
        tenantId: r.tenant_id,
        userId: r.assigned_to,
        type: NotificationTypes.OUTREACH_DRAFT_DUE,
        title: "Outreach email due",
        message: r.subject && r.subject.trim() ? r.subject : "A follow-up email is ready to send",
        link: `/leads/${r.lead_id}`,
      });
      outreachNotified++;
      draftProcessedIds.push(r.id);
    } catch (err) {
      logger.error({ err, draftId: r.id }, "reminders run: failed to notify outreach draft");
      // not stamped — retried next run
    }
  }

  if (draftProcessedIds.length > 0) {
    const { error: stampErr } = await supabase
      .from("sequence_step_drafts")
      .update({ notified_at: nowIso })
      .in("id", draftProcessedIds);
    if (stampErr) logger.error({ err: stampErr }, "reminders run: failed to stamp draft notified_at");
  }

  logger.info(
    { processed: draftProcessedIds.length, notified: outreachNotified },
    "outreach draft reminders run complete"
  );
  return { processed: draftProcessedIds.length, notified: outreachNotified };
}

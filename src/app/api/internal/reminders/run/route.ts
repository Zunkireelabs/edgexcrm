import { createServiceClient } from "@/lib/supabase/server";
import { apiUnauthorized, apiSuccess, apiInternalError } from "@/lib/api/response";
import { logger } from "@/lib/logger";
import { createNotification, NotificationTypes } from "@/lib/notifications";

// POST /api/internal/reminders/run
// Cron-triggered (Bearer INTERNAL_CRON_SECRET). Finds lead-task reminders that
// are due and not yet fired, notifies the lead's assignee, and stamps
// reminded_at so each reminder fires exactly once. Fail-closed.
export async function POST(request: Request) {
  const cronSecret = process.env.INTERNAL_CRON_SECRET;
  if (!cronSecret) {
    logger.error("INTERNAL_CRON_SECRET env var is not set — rejecting reminders run");
    return apiUnauthorized();
  }
  const authHeader = request.headers.get("authorization");
  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return apiUnauthorized();
  }

  const supabase = await createServiceClient();
  const nowIso = new Date().toISOString();

  // Due = remind_at passed, not yet fired, task incomplete, parent lead live.
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
    return apiInternalError(); // non-200 so cron job marks the run as failed
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
      // Row NOT stamped — will be retried on the next cron run.
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

  // ── Outreach drafts that just came due ──────────────────────────────────
  // Notify the draft's owner (assigned_to) once, when a pending draft on an
  // ACTIVE enrollment passes its due_at. notified_at is the fire-once stamp.
  //
  // No feature-gate here: this cron is cross-tenant service-role, and
  // sequence_step_drafts only exist for tenants that used the OUTREACH feature
  // (gated at enrollment creation). Presence of rows IS the scope.
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
    return apiInternalError();
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
    { processed: processedIds.length, notified, outreachProcessed: draftProcessedIds.length, outreachNotified },
    "reminders run complete"
  );
  return apiSuccess({
    processed: processedIds.length,
    notified,
    errors: 0,
    outreach_processed: draftProcessedIds.length,
    outreach_notified: outreachNotified,
  });
}

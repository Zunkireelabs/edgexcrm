import { createServiceClient } from "@/lib/supabase/server";
import { apiUnauthorized, apiSuccess } from "@/lib/api/response";
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
    return apiSuccess({ processed: 0, notified: 0, errors: 1 });
  }

  let notified = 0;
  const processedIds: string[] = [];

  for (const row of due ?? []) {
    processedIds.push(row.id);
    const lead = row.leads as unknown as { assigned_to: string | null };
    if (!lead?.assigned_to) continue; // no assignee → nothing to notify (still stamped to avoid re-scan)
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
    } catch (err) {
      logger.error({ err, checklistId: row.id }, "reminders run: failed to notify");
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

  logger.info({ processed: processedIds.length, notified }, "reminders run complete");
  return apiSuccess({ processed: processedIds.length, notified, errors: 0 });
}

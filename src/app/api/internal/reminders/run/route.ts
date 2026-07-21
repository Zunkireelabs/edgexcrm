import { apiUnauthorized, apiSuccess, apiInternalError } from "@/lib/api/response";
import { logger } from "@/lib/logger";
import { runTaskReminders, runOutreachDraftReminders } from "@/lib/inngest/jobs/reminders";

// POST /api/internal/reminders/run
// Cron-triggered (Bearer INTERNAL_CRON_SECRET). Runs the task-reminder and
// outreach-draft-due scans (shared with the Inngest ops-reminders-scan
// function) and stamps each fired row so it fires exactly once. Fail-closed.
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

  try {
    const tasks = await runTaskReminders();
    const outreach = await runOutreachDraftReminders();
    return apiSuccess({
      processed: tasks.processed,
      notified: tasks.notified,
      errors: 0,
      outreach_processed: outreach.processed,
      outreach_notified: outreach.notified,
    });
  } catch (err) {
    logger.error({ err }, "reminders run failed");
    return apiInternalError(); // non-200 so cron job marks the run as failed
  }
}

import { apiUnauthorized, apiSuccess } from "@/lib/api/response";
import { logger } from "@/lib/logger";
import { runEmailPoll } from "@/lib/inngest/jobs/email-poll";

export async function POST(request: Request) {
  // Fail-closed: if env var is unset, reject ALL requests (no bearer is ever valid)
  const cronSecret = process.env.INTERNAL_CRON_SECRET;
  if (!cronSecret) {
    logger.error("INTERNAL_CRON_SECRET env var is not set — rejecting poll request");
    return apiUnauthorized();
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return apiUnauthorized();
  }

  return apiSuccess(await runEmailPoll());
}

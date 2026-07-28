// Internal processor drain for email.inbound_received events.
// Guarded by INTERNAL_CRON_SECRET (same pattern as /api/internal/inbox/process).
// Call via: POST /api/internal/email/inbound/process
//   Authorization: Bearer <INTERNAL_CRON_SECRET>

import { apiUnauthorized, apiSuccess } from "@/lib/api/response";
import { logger } from "@/lib/logger";
import { processInboundEmailEvents } from "@/lib/email/process-inbound";

export async function POST(request: Request) {
  const cronSecret = process.env.INTERNAL_CRON_SECRET;
  if (!cronSecret) {
    logger.error("INTERNAL_CRON_SECRET env var is not set — rejecting email inbound process request");
    return apiUnauthorized();
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return apiUnauthorized();
  }

  const result = await processInboundEmailEvents(50);

  return apiSuccess({
    processed: result.processed,
    skipped: result.skipped,
    errors: result.errors,
  });
}

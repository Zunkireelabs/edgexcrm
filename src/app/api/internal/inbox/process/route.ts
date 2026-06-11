// Internal processor drain for inbox.inbound_received events.
// Guarded by INTERNAL_CRON_SECRET (same pattern as /api/internal/email/poll).
// Call via: POST /api/internal/inbox/process
//   Authorization: Bearer <INTERNAL_CRON_SECRET>

import { apiUnauthorized, apiSuccess } from "@/lib/api/response";
import { logger } from "@/lib/logger";
import { processInboundEvents } from "@/lib/inbox/process-inbound";

export async function POST(request: Request) {
  const cronSecret = process.env.INTERNAL_CRON_SECRET;
  if (!cronSecret) {
    logger.error("INTERNAL_CRON_SECRET env var is not set — rejecting inbox process request");
    return apiUnauthorized();
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return apiUnauthorized();
  }

  const result = await processInboundEvents(50);

  return apiSuccess({
    processed: result.processed,
    skipped: result.skipped,
    errors: result.errors,
  });
}

import { inngest } from "@/lib/inngest/client";
import { logger } from "@/lib/logger";

// Phase 0 liveness probe (cron-migration track). Proves the Inngest Cloud →
// serve-route path fires scheduled functions on time in each environment.
// Behavior-neutral: logs only, touches no tenant data. Dialed down to hourly now
// that ops-reminders-scan (Phase 1) provides the primary liveness signal.
export const heartbeat = inngest.createFunction(
  { id: "ops-heartbeat", triggers: [{ cron: "0 * * * *" }] },
  async () => {
    const firedAt = new Date().toISOString();
    logger.info({ firedAt, fn: "ops-heartbeat" }, "inngest heartbeat fired");
    return { firedAt };
  },
);

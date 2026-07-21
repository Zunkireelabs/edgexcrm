import { inngest } from "@/lib/inngest/client";
import { runEmailPoll } from "@/lib/inngest/jobs/email-poll";

// Durable replacement for the email-poll GitHub-Actions cron. DORMANT until
// EMAIL_REPLY_SYNC_ENABLED=true (Path B) — runEmailPoll early-returns {disabled:true}. Cheap */30
// cadence while dormant; tighten when Path B enables reply-sync (or make it event-driven).
export const emailPoll = inngest.createFunction(
  { id: "ops-email-poll", triggers: [{ cron: "*/30 * * * *" }] },
  async () => {
    return await runEmailPoll();
  },
);

import { inngest } from "@/lib/inngest/client";
import { processInboundEmailEvents } from "@/lib/email/process-inbound";

// Drains pending email.inbound_received events (Resend-native inbound spine,
// brief §9) -> email_threads/emails rows or inbound_email_dead_letter. No step
// wrapper: the `events` queue is the durability layer (status pending->
// completed, attempts, retry-to-failed at 3), and the `emails` insert is
// idempotent on (provider, provider_message_id), so overlapping runs are
// safe. Inngest only — never a GitHub-Actions `schedule:` (CLAUDE.md rule).
export const emailInboundProcess = inngest.createFunction(
  { id: "ops-email-inbound-process", triggers: [{ cron: "*/2 * * * *" }] },
  async () => {
    return await processInboundEmailEvents(50);
  },
);

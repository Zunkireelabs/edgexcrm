import { inngest } from "@/lib/inngest/client";
import { processInboundEvents } from "@/lib/inbox/process-inbound";

// Durable replacement for the inbox-process GitHub-Actions cron. Drains pending
// inbox.inbound_received events → conversations/messages/notifications. No step wrapper: the
// `events` queue is the durability layer (status pending→completed, attempts, retry-to-failed),
// and message insert is ON CONFLICT idempotent, so parallel-baking with the GH cron is safe.
// Inngest is environment-agnostic, so deploying this also gives PROD its first inbox cron
// (the previously-missing prod variant).
export const inboxProcess = inngest.createFunction(
  { id: "ops-inbox-process", triggers: [{ cron: "*/10 * * * *" }] },
  async () => {
    return await processInboundEvents(50);
  },
);

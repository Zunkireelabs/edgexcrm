import { inngest } from "@/lib/inngest/client";
import { processInboundEvents } from "@/lib/inbox/process-inbound";

// Durable replacement for the inbox-process GitHub-Actions cron. Drains pending
// inbox.inbound_received events → conversations/messages/notifications. No step wrapper: the
// `events` queue is the durability layer (status pending→completed, attempts, retry-to-failed),
// and message insert is ON CONFLICT idempotent, so parallel-baking with the GH cron is safe.
// Inngest is environment-agnostic, so deploying this also gives PROD its first inbox cron
// (the previously-missing prod variant).
//
// Cadence (2026-09-24): relaxed from */10 to */15 — this repo's own docs
// (docs/reference/03-INNGEST-BACKGROUND-JOBS.md §Free-tier budget, lever 1)
// already named this exact change as the standard first move when
// approaching the shared Hobby-tier execution budget; done now because the
// account had already run over budget (115,545/50,000), degrading every
// Inngest function across both staging and production.
export const inboxProcess = inngest.createFunction(
  { id: "ops-inbox-process", triggers: [{ cron: "*/15 * * * *" }] },
  async () => {
    return await processInboundEvents(50);
  },
);

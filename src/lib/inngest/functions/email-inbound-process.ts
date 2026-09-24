import { inngest } from "@/lib/inngest/client";
import { processInboundEmailEvents } from "@/lib/email/process-inbound";

// Drains pending email.inbound_received events (Resend-native inbound spine,
// brief §9) -> email_threads/emails rows or inbound_email_dead_letter. No step
// wrapper: the `events` queue is the durability layer (status pending->
// completed, attempts, retry-to-failed at 3), and the `emails` insert is
// idempotent on (provider, provider_message_id), so overlapping runs are
// safe. Inngest only — never a GitHub-Actions `schedule:` (CLAUDE.md rule).
//
// Cadence (2026-09-24): relaxed from */2 to */10 — at */2 this was the single
// largest consumer of the shared Inngest Hobby-tier monthly execution budget
// (~22k/month on its own, most of it "checked, nothing there"), and the
// account had run over budget (115,545/50,000), degrading every Inngest
// function across BOTH staging and production, including email blast sends
// (docs/reference/03-INNGEST-BACKGROUND-JOBS.md §Free-tier budget, lever 1).
// Worst-case added latency for an inbound reply landing in the inbox: ~10
// minutes instead of ~2 — acceptable for email (not a live-chat channel).
export const emailInboundProcess = inngest.createFunction(
  { id: "ops-email-inbound-process", triggers: [{ cron: "*/10 * * * *" }] },
  async () => {
    return await processInboundEmailEvents(50);
  },
);

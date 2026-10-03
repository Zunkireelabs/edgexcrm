// Next.js server-side registration hook. Loads the Sentry init for whichever
// runtime is booting, and wires `onRequestError` so unhandled server errors in
// App Router routes are captured automatically.

import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");

    // Node's default global dispatcher closes idle sockets after 4s, forcing a fresh
    // TLS handshake on most requests to Supabase. A longer keep-alive lets connections
    // survive between requests — see docs/PERF-ROUNDTRIP-BRIEF.md Task 4.
    const { setGlobalDispatcher, Agent } = await import("undici");
    setGlobalDispatcher(new Agent({ keepAliveTimeout: 60_000, keepAliveMaxTimeout: 600_000 }));

    // Dynamic, like every other server-only import here: this file is also bundled for the edge runtime, which must
    // never see the Supabase server client.
    const { startRunnerTimer } = await import("@/lib/ops/runner-timer");

    // Background workers run as in-process timers, NOT Inngest (its shared execution quota was exhausted once and
    // silently blocked every blast). startRunnerTimer guards against duplicate timers on dev hot reload and records a
    // heartbeat after every pass, so GET /api/health/runners can flag a stopped / wedged timer.
    // See src/lib/ops/runner-timer.ts for the registry (name + interval) and the staleness rule.

    // Email blasts (queued / mid-send / waiting out the daily cap) — src/lib/email/outbound/blast-runner.ts
    startRunnerTimer("email-blast", async () => {
      const { runEmailBlastQueue } = await import("@/lib/email/outbound/blast-runner");
      await runEmailBlastQueue();
    });

    // Sequence drafts a rep SCHEDULED, sent within about a minute of the chosen time —
    // src/lib/email/outbound/sequence-schedule-runner.ts
    startRunnerTimer("sequence-schedule", async () => {
      const { runScheduledSequenceSends } = await import("@/lib/email/outbound/sequence-schedule-runner");
      await runScheduledSequenceSends();
    });

    // Outreach bulk enroll: continues every queued / running run (the Start route also kicks a first pass with after()) —
    // outreach/lib/bulk-enroll-runner.ts
    startRunnerTimer("bulk-enroll", async () => {
      const { runBulkEnrollQueue } = await import("@/industries/_shared/features/outreach/lib/bulk-enroll-runner");
      await runBulkEnrollQueue();
    });
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;

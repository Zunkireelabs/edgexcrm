// Next.js server-side registration hook. Loads the Sentry init for whichever
// runtime is booting, and wires `onRequestError` so unhandled server errors in
// App Router routes are captured automatically.

import * as Sentry from "@sentry/nextjs";

// Guards against duplicate timers — register() can run more than once in the
// same process (Next dev-mode hot reload); without this a reload would stack
// a second interval on top of the first.
let emailBlastTimerStarted = false;
const EMAIL_BLAST_POLL_INTERVAL_MS = 30_000;

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");

    // Node's default global dispatcher closes idle sockets after 4s, forcing a fresh
    // TLS handshake on most requests to Supabase. A longer keep-alive lets connections
    // survive between requests — see docs/PERF-ROUNDTRIP-BRIEF.md Task 4.
    const { setGlobalDispatcher, Agent } = await import("undici");
    setGlobalDispatcher(new Agent({ keepAliveTimeout: 60_000, keepAliveMaxTimeout: 600_000 }));

    // Email-blast sending moved off Inngest 2026-09-28 (the shared Inngest
    // account's execution quota being exhausted was silently blocking every
    // blast from ever starting — see docs/SESSION-LOG.md). This timer is the
    // orchestrator now: it drives any blast that's queued, mid-send, or
    // waiting out the daily cap. See src/lib/email/outbound/blast-runner.ts
    // for the full design rationale.
    if (!emailBlastTimerStarted) {
      emailBlastTimerStarted = true;
      const { runEmailBlastQueue } = await import("@/lib/email/outbound/blast-runner");
      const { logger } = await import("@/lib/logger");
      setInterval(() => {
        runEmailBlastQueue().catch((err) => logger.error({ err }, "[blast-runner] periodic scan threw"));
      }, EMAIL_BLAST_POLL_INTERVAL_MS);
    }
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;

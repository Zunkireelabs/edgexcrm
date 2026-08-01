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
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;

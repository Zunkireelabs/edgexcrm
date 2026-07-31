// TEMPORARY — Sentry pipeline verification. REMOVE before the prod promotion.
//
// Why this exists: everything about the Sentry install is verifiable from
// outside the container EXCEPT the server SDK. The client DSN, environment tag,
// release and source-map debug IDs can all be read straight out of the deployed
// bundle. `sentry.server.config.ts` cannot — it does `enabled: !!dsn`, so if
// NEXT_PUBLIC_SENTRY_DSN fails to reach the server bundle the SDK goes inert
// and reports nothing, silently and indistinguishably from "no errors happened".
//
// Hitting this route proves three things at once:
//   1. sentry.server.config.ts initialized with a real DSN,
//   2. instrumentation.ts's `onRequestError` captures unhandled route errors,
//   3. uploaded source maps symbolicate a server frame back to THIS file/line.
//
// Safe by construction: unauthenticated (so it needs no stage session), and it
// throws on the first statement — it touches no database, no tenant, no PII.

export const dynamic = "force-dynamic";

export async function GET() {
  throw new Error(
    "EdgeX Sentry verification — deliberate unhandled server error from /api/sentry-verify"
  );
}

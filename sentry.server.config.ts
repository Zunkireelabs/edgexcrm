// Sentry — Node.js server runtime.
//
// ⚠️ PRIVACY POSTURE (deliberate, do not "restore defaults"):
// This app stores real customer PII — ~17k Admizz student records with names,
// emails and phone numbers. Several of the SDK's recommended defaults would
// ship that PII to a third party, so they are explicitly disabled here:
//   - dataCollection.userInfo / httpBodies -> request bodies routinely contain
//     lead payloads (names, emails, phones) on /api/v1/leads and the public
//     submit endpoint.
//   - includeLocalVariables -> attaches local variable VALUES to stack frames,
//     which on this codebase means whole Lead objects land in the issue.
//   - enableLogs -> pino log lines carry lead ids/emails.
// Errors + tracing (the actual baseline signal) remain fully on. Revisit only
// as a deliberate decision, not as a config tidy-up.

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // No DSN (local dev, CI build) -> SDK stays inert instead of warning per request.
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "development",
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,

  // Errors are always captured at 100%; only traces are sampled.
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  sendDefaultPii: false,
  includeLocalVariables: false,
  enableLogs: false,
});

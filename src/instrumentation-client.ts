// Sentry — browser runtime.
//
// Privacy posture matches sentry.server.config.ts — read the note there first.
// Session Replay is deliberately NOT enabled: it records the rendered screen,
// which on this app means recording counselors browsing real student records.
// Turning it on is a privacy decision, not a config improvement.
//
// ⚠️ WIDGET EXCLUSION: the `(widget)` route group (public embeddable form,
// served at /form/<slug>) is deliberately minimal — no fonts, no theme — and
// its TTFB is tracked work in its own right. It must not pay for Sentry. The
// guard below keeps the embeddable form from initializing the SDK, sending
// events, or opening a connection to Sentry.

import * as Sentry from "@sentry/nextjs";

/** Public embeddable form — see the widget-exclusion note above. */
function isWidgetRoute(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.pathname.startsWith("/form/");
}

if (!isWidgetRoute()) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

    // No DSN (local dev) -> stay inert rather than warn on every page.
    enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "development",
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,

    // Errors are captured at 100%; only traces are sampled.
    tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

    sendDefaultPii: false,
    enableLogs: false,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

import { createHash, randomUUID } from "crypto";
import { logger } from "@/lib/logger";

// The single seam every real Resend call in send.ts goes through (F3,
// docs/BLAST-FINDINGS-2026-09-06.md). Before this existed, the only guard on
// outbound email was EMAIL_OUTBOUND_SANDBOX — which only ever redirected the
// recipient (see env-guard.ts), never stopped the underlying
// resend.emails.send() call. That gap is what let 1,521 real emails go out
// from a local/test environment on 2026-09-06, from the production domain,
// on production credentials.
//
// Read at call time (not cached at module load) — same pattern as
// isEmailOutboundSandbox() in flag.ts — so a test can flip process.env and
// see the new value immediately, with no module-reset dance required.

export type EmailTransportMode = "stub" | "resend";

/**
 * Fail-closed: a real Resend send only happens when NODE_ENV is exactly
 * "production", OR the environment explicitly opts in with
 * EMAIL_TRANSPORT=resend. The NODE_ENV check is a backstop, not the primary
 * mechanism — stage and prod run the SAME Docker image (Dockerfile sets
 * NODE_ENV=production unconditionally), so NODE_ENV alone cannot tell them
 * apart. Both deployed environments instead set EMAIL_TRANSPORT explicitly in
 * their own docker-compose*.yml (prod=resend, stage=stub); a CI runner or a
 * laptop with a real RESEND_API_KEY in .env.local falls through to the
 * NODE_ENV backstop and gets "stub". A developer must set
 * EMAIL_TRANSPORT=resend deliberately to reach the real provider;
 * EMAIL_TRANSPORT=stub is honored even in production, for a deliberate dry
 * run.
 */
export function getEmailTransportMode(): EmailTransportMode {
  const explicit = process.env.EMAIL_TRANSPORT;
  if (explicit === "resend" || explicit === "stub") return explicit;
  return process.env.NODE_ENV === "production" ? "resend" : "stub";
}

export interface StubEmailSendResult {
  data: { id: string };
  error: null;
}

/**
 * Fakes a Resend send: records the call (to, from, subject, a body hash — not
 * the full body, which may contain PII) and returns a synthetic provider id.
 * Never opens a network connection. Always "succeeds" — this stub exists to
 * exercise materialization/volume at real scale (blast-scale Section 4), not
 * to simulate provider failures.
 */
export function sendStubEmail(payload: { to: string[]; from: string; subject: string; html: string }): StubEmailSendResult {
  const bodyHash = createHash("sha256").update(payload.html).digest("hex").slice(0, 16);
  const id = `stub_${randomUUID()}`;
  logger.info(
    { to: payload.to, from: payload.from, subject: payload.subject, bodyHash, providerMessageId: id },
    "[EMAIL_TRANSPORT=stub] recorded outbound email without calling Resend"
  );
  return { data: { id }, error: null };
}

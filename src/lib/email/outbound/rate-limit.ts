// Resend enforces a hard 10 requests/second cap, account-wide — this app uses
// one single RESEND_API_KEY for every tenant's blasts AND every one-off
// transactional send (see getResendClient() in ../index.ts), so the budget is
// shared across the whole process, not per-blast or per-tenant.
//
// sendQueuedEmailBatch fires SEND_CONCURRENCY concurrent calls with zero
// pacing between them — a Resend call typically resolves well under 500ms, so
// 5 workers racing each other easily bursts past 10/sec. Observed live: a
// 1,548-recipient blast where roughly half the rows came back "Too many
// requests. You can only make 10 requests per second," and — the real bug —
// each of those was marked permanently 'failed' on the first hit (see
// send.ts's retry-on-rate_limit_exceeded), even though the address was never
// actually bad.
//
// Sliding-window limiter, in-process only (this app runs a single Node
// process per environment — see CLAUDE.md's single `leads-crm` container).
// A distributed limiter would be needed if this ever runs as multiple
// instances sharing one RESEND_API_KEY; not the case today.

const WINDOW_MS = 1000;
// Under Resend's real 10/sec cap, not at it — headroom for clock jitter and
// any other concurrent Resend caller in this same process (e.g. an invite
// email firing while a blast is mid-send).
const MAX_CALLS_PER_WINDOW = 8;

let callTimestamps: number[] = [];

/** Resolves once it's safe to make another Resend call without exceeding the
 *  budget above. Await this immediately before every resend.emails.send(). */
export async function acquireResendRateLimitSlot(): Promise<void> {
  for (;;) {
    const now = Date.now();
    callTimestamps = callTimestamps.filter((t) => now - t < WINDOW_MS);
    if (callTimestamps.length < MAX_CALLS_PER_WINDOW) {
      callTimestamps.push(now);
      return;
    }
    const oldest = callTimestamps[0];
    const waitMs = WINDOW_MS - (now - oldest) + 5; // +5ms safety margin past the window boundary
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

/** Test-only: resets the shared window so tests don't leak state into each other. */
export function _resetResendRateLimitForTests(): void {
  callTimestamps = [];
}

import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { resolveTenantSender } from "../sender";
import { getResendClient } from "../index";
import { applyEmailEnvGuard } from "./env-guard";
import { loadSuppressedEmails, normalizeEmail } from "./suppression";
import { getOrCreateUnsubscribeToken, unsubscribeUrl, injectUnsubscribe } from "./unsubscribe";
import { buildBulkEmailHeaders } from "./headers";
import { getDailyCapStatus } from "./cap";
import { acquireResendRateLimitSlot } from "./rate-limit";
import { mapWithConcurrency } from "@/lib/sms/concurrency";
import { logger } from "@/lib/logger";

// The single orchestration path every future caller (Phase 1 blasts, Phase 2
// sequence auto-send, Phase 3 channel routing) goes through, and only this
// function. Modeled on sendQueuedBatch in src/lib/sms/send.ts — same shape,
// same ordering of safety checks, for the other channel.

const RECLAIM_THRESHOLD_MS = 15 * 60 * 1000; // §5.2
const MAX_RECLAIM_ATTEMPTS = 3;
const SEND_CONCURRENCY = 5;
// A rate_limit_exceeded response is transient by definition (Resend saying
// "not now", not "this address is bad") — retry it a few times with backoff
// before giving up, instead of marking a perfectly good recipient permanently
// 'failed' on the first 429. acquireResendRateLimitSlot() above should make
// this rare in practice; this is the safety net for whatever still slips
// through (e.g. another concurrent Resend caller in this same process).
const MAX_RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_RETRY_BASE_MS = 300;

interface QueuedEmailRow {
  id: string;
  tenant_id: string;
  lead_id: string | null;
  to_email: string;
  subject: string;
  body_html: string;
  status: string;
  sending_started_at: string | null;
  attempt_count: number;
}

export interface SendQueuedEmailBatchResult {
  sent: number;
  failed: number;
  suppressed: number;
  throttled: number;
}

export interface SendQueuedEmailBatchOptions {
  /**
   * OUTREACH-PHASE2-BRIEF.md §5.3 — pass "blast" from email-blast-send.ts so
   * the shared daily cap reserves headroom for due drip sends first; the
   * drip worker (sequence-step-send.ts) omits this and always sees the full
   * remaining. See cap.ts's GetDailyCapStatusOptions doc for the mechanism.
   */
  capCaller?: "blast" | "drip";
}

export async function sendQueuedEmailBatch(
  tenantId: string,
  messageIds: string[],
  opts: SendQueuedEmailBatchOptions = {}
): Promise<SendQueuedEmailBatchResult> {
  if (messageIds.length === 0) return { sent: 0, failed: 0, suppressed: 0, throttled: 0 };

  const db = await scopedClientForTenant(tenantId);

  // Step 1: load rows in ('queued','sending'). 'sending' is included for the
  // reclaim path below — a row stranded there after a crash is invisible to a
  // queued-only query and would otherwise never be retried or reported.
  const { data: rows, error } = await db
    .from("email_messages")
    .select("id, tenant_id, lead_id, to_email, subject, body_html, status, sending_started_at, attempt_count")
    .in("id", messageIds)
    .in("status", ["queued", "sending"]);

  if (error) throw new Error(`sendQueuedEmailBatch: failed to load messages: ${error.message}`);
  const loaded = (rows ?? []) as unknown as QueuedEmailRow[];
  if (loaded.length === 0) return { sent: 0, failed: 0, suppressed: 0, throttled: 0 };

  // §5.2 — a 'sending' row whose sending_started_at is older than 15 minutes
  // is reclaimable, up to attempt_count < 3, after which it goes to 'failed'
  // with an explicit error code rather than retrying forever. A 'sending' row
  // that is NOT yet stale is left untouched — it may genuinely be in flight.
  const now = Date.now();
  const sendable: QueuedEmailRow[] = [];
  const strandedFailIds: string[] = [];

  for (const row of loaded) {
    if (row.status === "queued") {
      sendable.push(row);
      continue;
    }
    const startedAtMs = row.sending_started_at ? new Date(row.sending_started_at).getTime() : 0;
    if (now - startedAtMs < RECLAIM_THRESHOLD_MS) continue; // not stale — may be genuinely in flight
    if (row.attempt_count >= MAX_RECLAIM_ATTEMPTS) {
      strandedFailIds.push(row.id);
      continue;
    }
    sendable.push(row);
  }

  if (strandedFailIds.length > 0) {
    logger.warn(
      { tenantId, strandedIds: strandedFailIds },
      "sendQueuedEmailBatch: stranded 'sending' row(s) exceeded max reclaim attempts — marking failed"
    );
    await db
      .from("email_messages")
      .update({
        status: "failed",
        error_code: "stranded_max_attempts",
        error_message: "Exceeded max reclaim attempts after being stranded in 'sending'.",
      })
      .in("id", strandedFailIds);
  }

  if (sendable.length === 0) {
    return { sent: 0, failed: strandedFailIds.length, suppressed: 0, throttled: 0 };
  }

  // Step 2: suppression safety net (§4.6 / §6.4). Redundant with Phase 1's
  // audience materialization on purpose — this is the one line of code every
  // send in the system passes through. One batched query, never one per
  // recipient (loadSuppressedEmails' contract). Should almost never fire.
  const emailByMessageId = new Map(sendable.map((m) => [m.id, normalizeEmail(m.to_email)]));
  const suppressedSet = await loadSuppressedEmails(db, tenantId, [...new Set(emailByMessageId.values())]);

  const toSend: QueuedEmailRow[] = [];
  const suppressedRows: QueuedEmailRow[] = [];
  for (const msg of sendable) {
    if (suppressedSet.has(emailByMessageId.get(msg.id)!)) suppressedRows.push(msg);
    else toSend.push(msg);
  }

  if (suppressedRows.length > 0) {
    logger.warn(
      { tenantId, suppressedCount: suppressedRows.length, suppressedIds: suppressedRows.map((m) => m.id) },
      "sendQueuedEmailBatch: recipient(s) found on the suppression list at send time — dropped. This safety net should " +
        "rarely fire; if it does often, the audience-materialization filter (Phase 1) is not doing its job."
    );
    await db
      .from("email_messages")
      .update({ status: "suppressed" })
      .in(
        "id",
        suppressedRows.map((m) => m.id)
      );
  }

  const failedSoFar = strandedFailIds.length;

  if (toSend.length === 0) {
    return { sent: 0, failed: failedSoFar, suppressed: suppressedRows.length, throttled: 0 };
  }

  // Step 3: daily cap. Over cap -> leave the remainder 'queued' and report a
  // throttled count. Never drop, never silently succeed. Shared with the
  // blast /preview route (Phase 1) via getDailyCapStatus — one place computes
  // "remaining today," so preview and enforcement can never drift apart.
  const { dailyCap, sentToday, remaining: remainingCapacity } = await getDailyCapStatus(db, {
    reserveForDrip: opts.capCaller === "blast",
  });

  const withinCap = toSend.slice(0, remainingCapacity);
  const throttledRows = toSend.slice(remainingCapacity);

  if (throttledRows.length > 0) {
    logger.warn(
      { tenantId, throttledCount: throttledRows.length, dailyCap, sentToday },
      "sendQueuedEmailBatch: daily send cap reached — remainder left queued, not dropped."
    );
  }

  if (withinCap.length === 0) {
    return { sent: 0, failed: failedSoFar, suppressed: suppressedRows.length, throttled: throttledRows.length };
  }

  // Step 4: sender resolution — already live, do not reimplement.
  const sender = await resolveTenantSender(tenantId);

  const resend = getResendClient();
  if (!resend) {
    throw new Error("sendQueuedEmailBatch: RESEND_API_KEY not configured.");
  }

  let sent = 0;

  // Step 5/6: per row, get-or-create the unsubscribe token, inject the
  // footer, build headers, apply the env guard, flip to 'sending', call
  // Resend, write back. Bounded concurrency (5 in flight) so a 16k batch
  // doesn't open 16k sockets at once — reused from src/lib/sms/concurrency.ts
  // rather than a second implementation.
  //
  // §5.3: one row = one resend.emails.send() call, always exactly one
  // recipient in `to`. Never cc/bcc, never Resend's batch endpoint. This
  // makes the NEW-1 attribution-by-array-index bug structurally unreachable —
  // each call's response id belongs unambiguously to the row that made it.
  await mapWithConcurrency(withinCap, SEND_CONCURRENCY, async (msg) => {
    // Env guard runs BEFORE any row mutation and is never caught here — a
    // misconfigured sandbox (EMAIL_TEST_RECIPIENTS empty) must abort the
    // whole batch, not be silently swallowed into a per-row 'failed'.
    const guarded = applyEmailEnvGuard(normalizeEmail(msg.to_email), msg.subject);

    const token = await getOrCreateUnsubscribeToken(db, tenantId, msg.to_email, msg.lead_id);
    const unsubUrl = unsubscribeUrl(token);
    const bodyWithFooter = injectUnsubscribe(msg.body_html, unsubUrl, {
      orgName: sender.orgName,
      mailingAddress: sender.mailingAddress,
    });
    const headers = buildBulkEmailHeaders(unsubUrl);

    await db
      .from("email_messages")
      .update({
        status: "sending",
        sending_started_at: new Date().toISOString(),
        attempt_count: msg.attempt_count + 1,
      })
      .eq("id", msg.id);

    try {
      let rateLimitRetries = 0;
      for (;;) {
        await acquireResendRateLimitSlot();
        const { data, error: sendError } = await resend.emails.send({
          from: sender.from,
          ...(sender.replyTo ? { replyTo: sender.replyTo } : {}),
          to: guarded.to,
          subject: guarded.subject,
          html: bodyWithFooter,
          headers,
        });

        if (sendError) {
          // A 429 is Resend saying "not now", not "this address is bad" — a
          // handful of retries with backoff recovers it instead of
          // permanently failing a perfectly good recipient (the actual bug:
          // every rate-limited row used to be marked 'failed' on the first
          // hit, see this function's module comment).
          if (sendError.name === "rate_limit_exceeded" && rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
            rateLimitRetries += 1;
            await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_RETRY_BASE_MS * rateLimitRetries));
            continue;
          }
          await db
            .from("email_messages")
            .update({ status: "failed", error_code: "provider_error", error_message: sendError.message })
            .eq("id", msg.id);
          return;
        }

        sent += 1;
        await db
          .from("email_messages")
          .update({ status: "sent", provider_message_id: data?.id ?? null, sent_at: new Date().toISOString() })
          .eq("id", msg.id);
        return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await db
        .from("email_messages")
        .update({ status: "failed", error_code: "exception", error_message: message })
        .eq("id", msg.id);
    }
  });

  const failed = failedSoFar + (withinCap.length - sent);

  return { sent, failed, suppressed: suppressedRows.length, throttled: throttledRows.length };
}

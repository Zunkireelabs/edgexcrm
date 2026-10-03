import type { ScopedClient } from "@/lib/supabase/scoped";
import { sendQueuedEmailBatch } from "@/lib/email/outbound/send";
import { normalizeEmail } from "@/lib/email/outbound/suppression";
import { logger } from "@/lib/logger";
import { markDraftSentViaEdgeX } from "./engine";

// The one place a sequence draft is handed to the outbound email spine. Used by BOTH the
// auto-send cron (sequence-autosend-runner.ts) and the rep's "Send now" button
// (POST /api/v1/outreach/drafts/[id]/send) so the two can never drift apart.
//
// Flow: look up the lead's email -> idempotently materialize an email_messages row (unique on
// source_id,lead_id) -> sendQueuedEmailBatch (suppression, daily cap, unsubscribe footer, sandbox
// guard, transport) -> on a real send, mark the draft sent via EdgeX (logs the timeline entry and
// advances the enrollment). The draft content is already fully rendered at draft-creation time.

export interface SendableDraft {
  id: string;
  lead_id: string;
  subject: string;
  body_html: string;
}

export type SendDraftResult =
  | { status: "sent"; emailMessageId: string }
  // The email had already gone out earlier (e.g. a crash between send and mark); the draft is healed.
  | { status: "already_sent" }
  | { status: "no_email" }
  // Daily cap reached: the draft stays pending and is picked up again later.
  | { status: "throttled" }
  // Another run is mid-send for this very message (its row is 'sending' and not yet stale), so
  // nothing was sent or failed here. Not an error: never treat it as a failure.
  | { status: "in_progress" }
  // A previous run already finished this message as failed/suppressed - nothing was re-sent.
  | { status: "already_handled"; messageStatus: string; errorCode: string | null; errorMessage: string | null }
  | { status: "failed"; suppressed: boolean; errorCode: string | null; errorMessage: string | null };

interface LeadEmailRow {
  email: string | null;
}

interface EmailMessageRow {
  id: string;
  status: string;
  error_code?: string | null;
  error_message?: string | null;
}

export async function sendDraftViaEdgeX(
  db: ScopedClient,
  tenantId: string,
  draft: SendableDraft,
  // "Send now" passes { sentBy }; the schedule runner passes { sentBy: scheduled_by, scheduled: true };
  // the auto-send cron omits it (timeline then says "automatically").
  opts?: { sentBy?: string | null; scheduled?: boolean }
): Promise<SendDraftResult> {
  const markSent = (emailMessageId: string) =>
    opts
      ? markDraftSentViaEdgeX(db, tenantId, draft.id, emailMessageId, opts)
      : markDraftSentViaEdgeX(db, tenantId, draft.id, emailMessageId);

  const { data: leadRow } = await db.from("leads").select("email").eq("id", draft.lead_id).maybeSingle();
  const email = (leadRow as LeadEmailRow | null)?.email;
  if (!email) {
    logger.warn({ tenantId, draftId: draft.id }, "sendDraftViaEdgeX: lead has no email — leaving draft pending");
    return { status: "no_email" };
  }

  // Idempotent materialization — (source_id, lead_id) unique, ignoreDuplicates makes a re-scan or a
  // double click a safe no-op instead of a second row.
  const { error: upsertError } = await db.from("email_messages").upsert(
    {
      lead_id: draft.lead_id,
      source: "sequence",
      source_id: draft.id,
      to_email: normalizeEmail(email),
      to_email_stored: email,
      subject: draft.subject,
      body_html: draft.body_html,
      status: "queued",
    },
    { onConflict: "source_id,lead_id", ignoreDuplicates: true }
  );
  if (upsertError) {
    logger.error({ err: upsertError, tenantId, draftId: draft.id }, "sendDraftViaEdgeX: failed to materialize email_messages row");
    return { status: "failed", suppressed: false, errorCode: "queue_error", errorMessage: "Couldn't queue the email" };
  }

  const loadMessage = async (): Promise<EmailMessageRow | null> => {
    const { data } = await db
      .from("email_messages")
      .select("id, status, error_code, error_message")
      .eq("source_id", draft.id)
      .eq("lead_id", draft.lead_id)
      .maybeSingle();
    return data as EmailMessageRow | null;
  };

  const message = await loadMessage();
  if (!message) {
    logger.error({ tenantId, draftId: draft.id }, "sendDraftViaEdgeX: email_messages row missing right after upsert");
    return { status: "failed", suppressed: false, errorCode: "queue_error", errorMessage: "Couldn't queue the email" };
  }

  if (message.status === "sent") {
    // Heal a crash between "provider accepted it" and "draft marked sent". No-op when already marked.
    await markSent(message.id);
    return { status: "already_sent" };
  }
  if (message.status !== "queued" && message.status !== "sending") {
    return {
      status: "already_handled",
      messageStatus: message.status,
      errorCode: message.error_code ?? null,
      errorMessage: message.error_message ?? null,
    };
  }

  const result = await sendQueuedEmailBatch(tenantId, [message.id]);

  if (result.sent === 1) {
    await markSent(message.id);
    return { status: "sent", emailMessageId: message.id };
  }
  if (result.throttled === 1) return { status: "throttled" };
  // sendQueuedEmailBatch leaves a non-stale 'sending' row untouched and reports all zeros.
  if (result.sent === 0 && result.failed === 0 && result.suppressed === 0 && result.throttled === 0) {
    return { status: "in_progress" };
  }

  // Failed or suppressed: the email_messages row carries the reason. The draft stays pending so a
  // human can resolve it (skip, or fall back to a manual send).
  const after = await loadMessage();
  return {
    status: "failed",
    suppressed: result.suppressed === 1,
    errorCode: after?.error_code ?? null,
    errorMessage: after?.error_message ?? null,
  };
}

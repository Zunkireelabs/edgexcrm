import type { ScopedClient } from "@/lib/supabase/scoped";
import { logger } from "@/lib/logger";
import { isSmsEnabledForTenant } from "@/lib/sms/flag";
import { toProviderRecipient, providerMsisdnToE164 } from "@/lib/sms/phone";
import { loadTenantSmsSettings, resolveTenantTimezone } from "@/lib/sms/settings";
import { resolveSendWindow } from "@/lib/sms/quiet-hours";
import { loadSuppressedPhones } from "@/lib/sms/suppression";
import { getOrCreateOptOutToken } from "@/lib/sms/optout";
import { composeRecipientMessage } from "@/lib/sms/compose";
import { sendQueuedBatch } from "@/lib/sms/send";
import { markDraftSentViaSms } from "./engine";
import { stopSmsEnrollmentsForLead } from "./stop-on-sms-optout";

// The SMS twin of send-draft.ts: the one place a sequence draft is handed to the SMS spine. Used by Send now,
// the schedule runner and auto-send, so they can never drift apart.
//
// Flow: SMS enabled for the tenant -> lead's phone -> existing message for this draft? (retry-safe) -> opt-out check ->
// compose (sender label + text + opt-out footer, same as blasts) -> queue an sms_messages row (source 'sequence') ->
// reserve credits -> sendQueuedBatch -> settle credits (always) -> on a real send, mark the draft sent and advance.
// The draft's body (draft.body_html) already holds the merged plain text; for an SMS draft subject is ''.

export const SMS_SEQUENCE_REF_TYPE = "sms_sequence";

export interface SendableSmsDraft {
  id: string;
  lead_id: string;
  body_html: string;
  sms_message_id?: string | null;
}

export type SendSmsDraftResult =
  | { status: "sent"; smsMessageId: string }
  // The text had already gone out earlier (a crash between send and mark); the draft is healed.
  | { status: "already_sent" }
  | { status: "sms_disabled" }
  | { status: "no_phone"; reason: string }
  // Not enough credits: nothing was sent or charged, the draft stays pending and can be retried after a top-up.
  | { status: "no_credits" }
  | { status: "in_progress" }
  // A previous attempt already finished this message as failed/suppressed/cancelled - nothing was re-sent.
  | { status: "already_handled"; messageStatus: string; errorCode: string | null; errorMessage: string | null }
  | { status: "failed"; suppressed: boolean; errorCode: string | null; errorMessage: string | null };

interface SmsMessageRow {
  id: string;
  status: string;
  error_code?: string | null;
  error_message?: string | null;
}

const SENT_STATUSES = new Set(["submitted", "delivered"]);

export async function sendDraftViaSms(
  db: ScopedClient,
  tenantId: string,
  draft: SendableSmsDraft
): Promise<SendSmsDraftResult> {
  if (!(await isSmsEnabledForTenant(tenantId))) return { status: "sms_disabled" };

  // Nothing is sent for an empty message (it would go out as only the sender name and the opt-out link).
  if (!draft.body_html?.trim()) {
    return { status: "failed", suppressed: false, errorCode: "empty_message", errorMessage: "The message is empty, so it was not sent." };
  }

  const { data: leadRow } = await db
    .from("leads")
    .select("phone, first_name, last_name, email, city, country, custom_fields")
    .eq("id", draft.lead_id)
    .maybeSingle();
  const lead = leadRow as ({ phone: string | null; custom_fields?: Record<string, unknown> | null } & Record<string, unknown>) | null;
  const recipient = toProviderRecipient(lead?.phone);
  if (!recipient.ok) {
    logger.warn({ tenantId, draftId: draft.id, reason: recipient.reason }, "sendDraftViaSms: lead has no usable phone — leaving draft pending");
    return { status: "no_phone", reason: recipient.reason };
  }
  const phoneE164 = providerMsisdnToE164(recipient.msisdn);

  const loadMessage = async (id: string): Promise<SmsMessageRow | null> => {
    const { data } = await db.from("sms_messages").select("id, status, error_code, error_message").eq("id", id).maybeSingle();
    return data as SmsMessageRow | null;
  };

  // Retry safety: the draft remembers its message, so a second click / cron pass finds it instead of queuing a second text.
  let message: SmsMessageRow | null = draft.sms_message_id ? await loadMessage(draft.sms_message_id) : null;

  if (message) {
    if (SENT_STATUSES.has(message.status)) {
      await markDraftSentViaSms(db, tenantId, draft.id, message.id);
      return { status: "already_sent" };
    }
    if (message.status === "sending") return { status: "in_progress" };
    if (message.status !== "queued" && message.status !== "deferred") {
      return {
        status: "already_handled",
        messageStatus: message.status,
        errorCode: message.error_code ?? null,
        errorMessage: message.error_message ?? null,
      };
    }
  } else {
    // Opted-out numbers are never texted (checked before any credit is reserved; sendQueuedBatch re-checks as a safety net).
    const suppressed = await loadSuppressedPhones(db, tenantId, [phoneE164]);
    if (suppressed.has(phoneE164)) {
      // They opted out (maybe under another lead record with the same number): end this lead's SMS sequence.
      await stopSmsEnrollmentsForLead(db, { tenantId, leadId: draft.lead_id, reason: "opt_out" });
      return { status: "failed", suppressed: true, errorCode: "suppressed", errorMessage: "This number has opted out of SMS" };
    }

    const settings = await loadTenantSmsSettings(db);
    const token = await getOrCreateOptOutToken(db, tenantId, phoneE164, draft.lead_id);
    const composed = composeRecipientMessage(settings, draft.body_html, { lead: lead ?? {} }, token);

    const { data: inserted, error: insertError } = await db
      .from("sms_messages")
      .insert({
        lead_id: draft.lead_id,
        source: "sequence",
        to_phone: recipient.msisdn,
        to_phone_stored: lead?.phone != null ? String(lead.phone) : null,
        body: composed.text,
        encoding: composed.segments.encoding,
        segments: composed.segments.segments,
        estimated_credits: composed.segments.credits,
        status: "queued",
      })
      .select("id, status")
      .single();
    if (insertError || !inserted) {
      logger.error({ err: insertError, tenantId, draftId: draft.id }, "sendDraftViaSms: failed to queue sms_messages row");
      return { status: "failed", suppressed: false, errorCode: "queue_error", errorMessage: "Couldn't queue the text message" };
    }
    message = inserted as unknown as SmsMessageRow;

    // Claim the draft for this message. If another run claimed it first (double click / cron overlap), drop ours and let
    // that run finish: nothing has been reserved or sent for our row yet.
    const { data: claimed } = await db
      .from("sequence_step_drafts")
      .update({ sms_message_id: message.id })
      .eq("id", draft.id)
      .is("sms_message_id", null)
      .select("id");
    if (!claimed || claimed.length === 0) {
      await db.from("sms_messages").delete().eq("id", message.id);
      return { status: "in_progress" };
    }
  }

  const messageId = message.id;
  const estimated = await estimatedCredits(db, messageId);

  // Reserve -> send -> settle, keyed on this message's id (idempotent per message).
  const { data: reserveResult, error: reserveError } = await db.rpc("sms_credits_reserve", {
    p_amount: estimated,
    p_ref_type: SMS_SEQUENCE_REF_TYPE,
    p_ref_id: messageId,
  });
  const reserve = reserveResult as { ok?: boolean } | null;
  if (reserveError || !reserve?.ok) {
    logger.warn({ tenantId, draftId: draft.id, messageId, err: reserveError, estimated }, "sendDraftViaSms: could not reserve credits");
    // Nothing was sent or charged: unlink + drop the queued row so a later retry (after a top-up) starts clean.
    await db.from("sequence_step_drafts").update({ sms_message_id: null }).eq("id", draft.id);
    await db.from("sms_messages").delete().eq("id", messageId);
    return { status: "no_credits" };
  }

  let charged = 0;
  let sent = 0;
  try {
    const result = await sendQueuedBatch(tenantId, [messageId]);
    charged = result.totalCreditsCharged;
    sent = result.sent;
  } catch (err) {
    logger.error({ err, tenantId, draftId: draft.id, messageId }, "sendDraftViaSms: send threw");
  } finally {
    // Always settle: an open reservation would silently shrink the tenant's balance.
    const { error: settleError } = await db.rpc("sms_credits_settle", {
      p_ref_id: messageId,
      p_reserved: estimated,
      p_actual: charged,
      p_ref_type: SMS_SEQUENCE_REF_TYPE,
    });
    if (settleError) logger.error({ err: settleError, tenantId, messageId }, "sendDraftViaSms: sms_credits_settle failed");
  }

  // The provider took it (counted as sent), OR the message row says it was submitted / delivered even though the batch did
  // not count it (e.g. a recipient the provider accepted but could not be matched back yet — it stays "submitted" for the
  // delivery poller to settle). Either way a text really went out, so the draft is sent: reporting it as failed would
  // invite a second text.
  const after = await loadMessage(messageId);
  if (sent === 1 || (after && SENT_STATUSES.has(after.status))) {
    await markDraftSentViaSms(db, tenantId, draft.id, messageId);
    return { status: "sent", smsMessageId: messageId };
  }

  // sendQueuedBatch leaves the reason on the message row (failed / suppressed).
  return {
    status: "failed",
    suppressed: after?.status === "suppressed",
    errorCode: after?.error_code ?? null,
    errorMessage: after?.error_message ?? null,
  };
}

async function estimatedCredits(db: ScopedClient, messageId: string): Promise<number> {
  const { data } = await db.from("sms_messages").select("estimated_credits").eq("id", messageId).maybeSingle();
  const credits = (data as { estimated_credits?: number | null } | null)?.estimated_credits;
  return typeof credits === "number" && credits > 0 ? credits : 1;
}

/**
 * Quiet hours for UNATTENDED SMS (auto-send and the schedule runner), the same window blasts honour. Returns the time the
 * draft may go out when "now" is inside quiet hours, or null when it may send now. A rep's own "Send now" click is not
 * held back: they chose to send at that moment.
 */
export async function smsQuietHoursDeferral(db: ScopedClient, tenantId: string, now: Date = new Date()): Promise<Date | null> {
  const settings = await loadTenantSmsSettings(db);
  if (!settings.quiet_hours_enabled) return null;
  const timezone = await resolveTenantTimezone(db, tenantId, settings.timezone);
  const window = resolveSendWindow(now, timezone, settings.quiet_hours_start, settings.quiet_hours_end);
  return window.allowed ? null : window.deferUntil;
}

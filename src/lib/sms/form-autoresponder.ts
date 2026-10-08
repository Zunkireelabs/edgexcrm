import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { createRequestLogger } from "@/lib/logger";
import type { FormConfig, Lead } from "@/types/database";
import { isSmsEnabledForTenant } from "./flag";
import { toProviderRecipient, providerMsisdnToE164 } from "./phone";
import { loadTenantSmsSettings } from "./settings";
import { loadSuppressedPhones } from "./suppression";
import { getOrCreateOptOutToken } from "./optout";
import { composeRecipientMessage } from "./compose";
import { sendQueuedBatch } from "./send";

// Per-form "Confirmation SMS": the SMS twin of lib/email/form-autoresponder.ts. Sends one text to
// the person who just submitted a form. Fully fire-and-forget — callers `void` it and it never
// rejects into the submission path, because losing a lead over a failed text is not acceptable.
//
// Decisions (agreed 2026-10-08):
//  - The opt-out footer is INCLUDED (composeRecipientMessage adds it, same as blasts).
//  - Quiet hours are NOT applied: a confirmation is the direct reply to something the person just
//    did, so it goes out immediately. (Blasts still honour quiet hours.)
//  - Any tenant with SMS enabled may use it; the tenant gate is isSmsEnabledForTenant.

// A retried submission (double click, client retry, webhook replay) must not text someone twice.
// The email twin only logs; here we refuse a second text for the same lead + form inside this window.
export const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

export const SMS_FORM_REF_TYPE = "sms_form_autoresponder";

export type FormSmsOutcome =
  | { status: "sent"; messageId: string }
  | { status: "failed"; messageId: string; reason: string }
  | { status: "skipped"; reason: string };

const skipped = (reason: string): FormSmsOutcome => ({ status: "skipped", reason });

export async function processFormSmsAutoresponder(
  formConfig: FormConfig,
  lead: Lead,
  opts: { isResubmission: boolean }
): Promise<FormSmsOutcome> {
  const log = createRequestLogger({
    requestId: crypto.randomUUID(),
    method: "FORM_SMS_AUTORESPONDER",
    path: "process",
  });
  const ctx = { formId: formConfig.id, leadId: lead.id };

  // Every skip is logged (except "disabled", which is the normal state for most forms and would
  // log on every submission) so "why didn't it text?" is answerable from the server log.
  const skip = (reason: string): FormSmsOutcome => {
    if (reason !== "disabled") log.info({ ...ctx, reason }, "Form SMS autoresponder skipped");
    return skipped(reason);
  };

  try {
    const cfg = formConfig.autoresponder?.sms;
    if (!cfg?.enabled) return skip("disabled");
    if (!cfg.body || !cfg.body.trim()) return skip("empty_body");
    if (cfg.fire_mode === "first" && opts.isResubmission) return skip("resubmission");

    const tenantId = lead.tenant_id;
    if (!(await isSmsEnabledForTenant(tenantId))) return skip("sms_not_enabled_for_tenant");

    const recipient = toProviderRecipient(lead.phone);
    if (!recipient.ok) {
      return skip(`phone_${recipient.reason}`);
    }
    const phoneE164 = providerMsisdnToE164(recipient.msisdn);

    const db = await scopedClientForTenant(tenantId);

    // Duplicate guard, keyed on the PHONE NUMBER (not the lead): a resubmission can create a brand
    // new lead row for the same person, and it is the recipient we must not text twice. Not a hard
    // constraint (fire_mode "every" legitimately sends repeatedly over time), so two truly
    // simultaneous requests could still both pass; the window closes the common retry case, and the
    // opt-out/credit checks below still bound the damage.
    const since = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString();
    const { data: recent } = await db
      .from("sms_messages")
      .select("id")
      .eq("source", "form_autoresponder")
      .eq("to_phone", recipient.msisdn)
      .eq("form_config_id", formConfig.id)
      .gte("created_at", since)
      .limit(1);
    if (recent && recent.length > 0) {
      log.info(ctx, "Confirmation SMS already sent to this number for this form recently, skipping");
      return skip("duplicate");
    }

    // Opted-out numbers are never texted. Checked here (before any credit is reserved) as well as
    // by sendQueuedBatch's safety net.
    const suppressed = await loadSuppressedPhones(db, tenantId, [phoneE164]);
    if (suppressed.has(phoneE164)) return skip("suppressed");

    const settings = await loadTenantSmsSettings(db);
    const token = await getOrCreateOptOutToken(db, tenantId, phoneE164, lead.id);
    // Custom-field answers are merge-taggable too; real lead columns win on a name clash.
    const mergeSource = { ...(lead.custom_fields ?? {}), ...lead } as Record<string, unknown>;
    const composed = composeRecipientMessage(settings, cfg.body, { lead: mergeSource }, token);

    const { data: inserted, error: insertError } = await db
      .from("sms_messages")
      .insert({
        lead_id: lead.id,
        form_config_id: formConfig.id,
        source: "form_autoresponder",
        to_phone: recipient.msisdn,
        to_phone_stored: lead.phone != null ? String(lead.phone) : null,
        body: composed.text,
        encoding: composed.segments.encoding,
        segments: composed.segments.segments,
        estimated_credits: composed.segments.credits,
        status: "queued",
      })
      .select("id")
      .single();
    if (insertError || !inserted) {
      log.error({ ...ctx, err: insertError }, "Failed to queue confirmation SMS");
      return skip("queue_failed");
    }
    const messageId = (inserted as unknown as { id: string }).id;

    // Reserve -> send -> settle, keyed on this message's id (idempotent per message).
    const estimated = composed.segments.credits;
    const { data: reserveResult, error: reserveError } = await db.rpc("sms_credits_reserve", {
      p_amount: estimated,
      p_ref_type: SMS_FORM_REF_TYPE,
      p_ref_id: messageId,
    });
    const reserve = reserveResult as { ok?: boolean } | null;
    if (reserveError || !reserve?.ok) {
      const reason = reserveError ? "credit_reserve_error" : "insufficient_credits";
      log.warn({ ...ctx, messageId, err: reserveError, estimated }, "Could not reserve credits for confirmation SMS");
      await db
        .from("sms_messages")
        .update({ status: "failed", error_code: reason, error_message: "Not enough SMS credits to send" })
        .eq("id", messageId);
      return { status: "failed", messageId, reason };
    }

    let charged = 0;
    let sendFailed = false;
    try {
      const result = await sendQueuedBatch(tenantId, [messageId]);
      charged = result.totalCreditsCharged;
      sendFailed = result.sent === 0;
    } catch (err) {
      sendFailed = true;
      log.error({ ...ctx, messageId, err }, "Confirmation SMS send threw");
    } finally {
      // Always release/settle: a reservation left open would silently shrink the tenant's balance
      // (the credit reaper only sweeps blasts).
      const { error: settleError } = await db.rpc("sms_credits_settle", {
        p_ref_id: messageId,
        p_reserved: estimated,
        p_actual: charged,
        p_ref_type: SMS_FORM_REF_TYPE,
      });
      if (settleError) log.error({ ...ctx, messageId, err: settleError }, "sms_credits_settle failed for confirmation SMS");
    }

    if (sendFailed) return { status: "failed", messageId, reason: "send_failed" };
    log.info({ ...ctx, messageId, charged }, "Confirmation SMS sent");
    return { status: "sent", messageId };
  } catch (err) {
    log.error({ ...ctx, err }, "Form SMS autoresponder failed");
    return skip("error");
  }
}

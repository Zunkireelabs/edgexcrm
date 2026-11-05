import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { getResendClient, EMAIL_FROM } from "../index";
import { getEmailTransportMode, sendStubEmail } from "../outbound/transport";
import { resolveRecipients } from "./recipients";
import { claimLedgerRow, settleLedgerRow, type LedgerKey } from "./ledger";
import type {
  DispatchSummary,
  NotificationEmailEvent,
  NotifyDb,
  NotifyMessage,
  NotifyRecipient,
  NotifyTenant,
} from "./types";

/**
 * Send one notification email per recipient — safely, once, and without ever hurting the caller.
 *
 *  - NEVER throws. A failure is logged and recorded in the ledger; the caller (e.g. lead creation) is unaffected.
 *    Call it as `void dispatchNotificationEmail(...).catch(() => {})` AFTER the DB write.
 *  - ONE send per recipient (never a shared To: list, so addresses stay private).
 *  - Exactly-once per (event, entity, recipient) via the `notification_email_log` ledger (migration 281): a row is
 *    CLAIMED (status 'pending', UNIQUE) before sending and only becomes 'sent' once the provider confirms — never
 *    optimistically (CLAUDE.md "Two-System Writes: Verify Before You Persist"). Retries, double calls and races hit
 *    the unique key and are skipped. If the ledger can't be written, nothing is sent (fail closed — a missing
 *    ledger must not turn into duplicate emails).
 *  - Honours EMAIL_TRANSPORT (outbound/transport.ts): stage/local get a logged stub, not a real send.
 *
 * Adding a new alert = writing one NotificationEmailEvent (see ./events/new-lead.ts). Nothing here changes.
 */

export interface SendArgs {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
}
export type SendResult = { id: string | null; error: string | null };
export type SendFn = (args: SendArgs) => Promise<SendResult>;

/** Production sender: stub/real selected by EMAIL_TRANSPORT. `null` when real sending is selected but not configured. */
function defaultSender(): SendFn | null {
  if (getEmailTransportMode() === "stub") {
    return async (a) => ({ id: sendStubEmail({ to: [a.to], from: a.from, subject: a.subject, html: a.html }).data.id, error: null });
  }
  const resend = getResendClient();
  if (!resend) return null;
  return async (a) => {
    const { data, error } = await resend.emails.send({ from: a.from, to: a.to, subject: a.subject, html: a.html, text: a.text });
    return { id: data?.id ?? null, error: error ? error.message : null };
  };
}

export async function dispatchNotificationEmail<P, C>(
  event: NotificationEmailEvent<P, C>,
  payload: P,
  deps: { db?: NotifyDb; send?: SendFn } = {}
): Promise<DispatchSummary> {
  const summary: DispatchSummary = { sent: 0, failed: 0, duplicates: 0 };
  let tenantId = "unknown";
  let entityId = "unknown";
  try {
    tenantId = event.tenantId(payload);
    entityId = event.entityId(payload);
    const db = deps.db ?? ((await createServiceClient()) as NotifyDb);

    const context = await event.prepare(payload, db);
    if (context === null) return { ...summary, skipped: "not_eligible" };

    const send = deps.send ?? defaultSender();
    if (!send) {
      logger.warn({ event: event.id, tenantId, entityId }, "notify: email transport not configured, skipping");
      return { ...summary, skipped: "email_not_configured" };
    }

    const { data: t } = await db.from("tenants").select("id, name, primary_color").eq("id", tenantId).maybeSingle();
    if (!t) return { ...summary, skipped: "no_tenant" };
    const tenant: NotifyTenant = {
      id: (t as { id: string }).id,
      name: (t as { name: string }).name,
      primaryColor: (t as { primary_color: string }).primary_color,
    };

    const recipients = await resolveRecipients(db, tenantId, event.roles);
    if (recipients.length === 0) return { ...summary, skipped: "no_recipients" };

    const outcomes = await Promise.allSettled(
      recipients.map((recipient) => sendToRecipient({ event, payload, context, tenant, recipient, db, send, entityId }))
    );
    for (const o of outcomes) {
      if (o.status === "rejected") summary.failed++;
      else summary[o.value]++;
    }
    return summary;
  } catch (err) {
    logger.error({ err, event: event.id, tenantId, entityId }, "notify: dispatch failed");
    return { ...summary, skipped: "error" };
  }
}

async function sendToRecipient<P, C>(a: {
  event: NotificationEmailEvent<P, C>;
  payload: P;
  context: C;
  tenant: NotifyTenant;
  recipient: NotifyRecipient;
  db: NotifyDb;
  send: SendFn;
  entityId: string;
}): Promise<"sent" | "failed" | "duplicates"> {
  const { event, tenant, recipient, db, entityId } = a;
  const key: LedgerKey = { tenant_id: tenant.id, event: event.id, entity_id: entityId, recipient_email: recipient.email };
  const logCtx = { event: event.id, tenantId: tenant.id, entityId, recipient: recipient.email };

  // 1. Claim. UNIQUE (event, entity_id, recipient_email) makes this the exactly-once gate (see ./ledger.ts).
  const claim = await claimLedgerRow(db, key);
  if (claim === "duplicate") return "duplicates";
  if (claim === "error") return "failed";

  const settle = (patch: { status: "sent" | "failed"; error?: string | null; provider_message_id?: string | null }) =>
    settleLedgerRow(db, key, patch);

  // 2. Build + send. Only a provider-confirmed id becomes 'sent'.
  try {
    const message: NotifyMessage = event.build({ payload: a.payload, context: a.context, tenant, recipient });
    const res = await a.send({ to: recipient.email, from: EMAIL_FROM, ...message });
    if (res.error || !res.id) {
      const reason = res.error ?? "provider returned no message id";
      logger.error({ ...logCtx, reason }, "notify: email send failed");
      await settle({ status: "failed", error: reason });
      return "failed";
    }
    await settle({ status: "sent", provider_message_id: res.id });
    logger.info({ ...logCtx, providerMessageId: res.id }, "notify: email sent");
    return "sent";
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown error";
    logger.error({ err, ...logCtx }, "notify: email send threw");
    await settle({ status: "failed", error: reason });
    return "failed";
  }
}

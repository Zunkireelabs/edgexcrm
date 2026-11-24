import { randomUUID } from "crypto";
import type { ScopedClient } from "@/lib/supabase/scoped";
import { mintToken } from "../inbound/tokens";
import { sanitizeDisplayName } from "../reply-to-label";
import { syntheticMessageId } from "../synthetic-message-id";
import { logger } from "@/lib/logger";

// Reply capture for company-sender email.
//
// When EdgeX sends from the company address (Outreach sequence steps, campaigns,
// one-off emails), the lead's reply would otherwise go to the tenant's Reply-To
// mailbox and EdgeX would never see it — so it could neither show the reply on the
// lead nor stop the sequence. This points Reply-To at a per-message EdgeX address
// (the inbound spine, migration 191) instead: the reply lands on the lead's thread,
// notifies the counsellor, stops the sequence, and process-inbound forwards a copy to
// the team mailbox.
//
// Gating is IDENTICAL to the Gmail pop-up path (api/v1/email/send): the
// EDGEX_INBOUND_ENABLED env flag AND the tenant's inbound_enabled setting. With the
// flag off (prod today) every function here returns immediately with no queries, so
// sending behaves exactly as it did before this file existed.
//
// Failure policy: reply capture is an enhancement, never a dependency. Anything that
// goes wrong here is logged and swallowed, the affected messages fall back to the
// tenant's normal Reply-To, and the send proceeds. Nothing in here may throw.
//
// Scale: a 5,000-message day is 5,000 threads + 5,000 reply tokens + 5,000 outbound
// emails rows. They are written in CHUNKED BULK inserts (never one query per message)
// — the connection-pool contention that bit the unsubscribe-token path (see the
// TEMPORARY REVERT note in send.ts) came from per-row writes in the hot loop.

const PROVISION_CHUNK = 200;
const EMAIL_ROW_CHUNK = 50; // body_html can be large — keep each insert payload bounded

/** Inbound capture is on for this tenant: env flag AND tenant setting. Never throws. */
export async function isReplyCaptureEnabled(db: ScopedClient): Promise<boolean> {
  if (process.env.EDGEX_INBOUND_ENABLED !== "true") return false;
  try {
    const { data } = await db
      .from("tenant_email_settings")
      .select("inbound_enabled")
      .maybeSingle<{ inbound_enabled: boolean }>();
    return !!data?.inbound_enabled;
  } catch (err) {
    logger.warn({ err }, "reply-capture: could not read tenant inbound_enabled — treating as off");
    return false;
  }
}

export interface BulkReplyMessage {
  id: string;
  lead_id: string | null;
  subject: string;
}

export interface ProvisionedReply {
  threadId: string;
  /** Value for the Reply-To header: `"Org" <reply+…@inbound-domain>`. */
  replyTo: string;
  leadId: string;
  subject: string;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function deleteThreads(db: ScopedClient, threadIds: string[]): Promise<void> {
  // email_threads → inbound_addresses is ON DELETE CASCADE (migration 191), so this also removes the tokens.
  for (const part of chunk(threadIds, PROVISION_CHUNK)) {
    try {
      await db.from("email_threads").delete().in("id", part);
    } catch (err) {
      logger.warn({ err }, "reply-capture: failed to delete provisional threads (non-fatal)");
    }
  }
}

/**
 * Creates one empty thread + one reply token per message that has a lead, BEFORE the
 * send, so the Reply-To header can point at it. Returns messageId → reply info; messages
 * with no lead, or every message when capture is off/failed, are simply absent from the map.
 * All-or-nothing: on any failure everything created so far is removed and the map is empty.
 */
export async function provisionBulkReplyCapture(
  db: ScopedClient,
  messages: BulkReplyMessage[],
  orgName: string,
): Promise<Map<string, ProvisionedReply>> {
  const eligible = messages.filter((m) => !!m.lead_id);
  if (eligible.length === 0) return new Map();
  if (!(await isReplyCaptureEnabled(db))) return new Map();

  const result = new Map<string, ProvisionedReply>();
  const createdThreadIds: string[] = [];

  try {
    const label = sanitizeDisplayName(orgName);
    const nowIso = new Date().toISOString();

    for (const part of chunk(eligible, PROVISION_CHUNK)) {
      // IDs and tokens are generated here, not read back from the insert, so mapping a
      // message to its thread never depends on the order rows come back in.
      const prepared = part.map((m) => ({ m, threadId: randomUUID(), minted: mintToken("reply") }));

      const { error: threadErr } = await db.from("email_threads").insert(
        prepared.map((p) => ({
          id: p.threadId,
          provider: "edgex_native",
          connected_email_account_id: null,
          gmail_thread_id: null,
          lead_id: p.m.lead_id,
          contact_id: null,
          subject: p.m.subject,
          last_message_at: nowIso,
          message_count: 0,
        })),
      );
      if (threadErr) throw new Error(`email_threads bulk insert failed: ${threadErr.message}`);
      createdThreadIds.push(...prepared.map((p) => p.threadId));

      const { error: addrErr } = await db.from("inbound_addresses").insert(
        prepared.map((p) => ({
          kind: "thread",
          verb: "reply",
          token: p.minted.token,
          thread_id: p.threadId,
          user_id: null,
          status: "active",
        })),
      );
      if (addrErr) throw new Error(`inbound_addresses bulk insert failed: ${addrErr.message}`);

      for (const p of prepared) {
        result.set(p.m.id, {
          threadId: p.threadId,
          replyTo: label ? `"${label}" <${p.minted.address}>` : p.minted.address,
          leadId: p.m.lead_id as string,
          subject: p.m.subject,
        });
      }
    }
    return result;
  } catch (err) {
    logger.error({ err }, "reply-capture: provisioning failed — sending with the tenant Reply-To instead");
    await deleteThreads(db, createdThreadIds);
    return new Map();
  }
}

export interface SentReplyRecord {
  provisioned: ProvisionedReply;
  /** Body as sent, WITHOUT the marketing unsubscribe footer. */
  bodyHtml: string;
  toEmail: string;
  fromAddress: string;
  fromName: string;
  providerMessageId: string | null;
}

/** Splits a `Name <addr>` From header into its parts (a bare address yields an empty name). */
export function parseFromHeader(from: string): { address: string; name: string } {
  const m = from.match(/^(.*)<([^>]+)>\s*$/);
  if (!m) return { address: from.trim(), name: "" };
  return { address: m[2].trim(), name: m[1].replace(/["]/g, "").trim() };
}

/**
 * After the sends: for messages that went out, mark the thread as having 1 message and
 * record the outbound email on it (so the lead's Emails tab shows what was sent and the
 * reply under it); for messages that did NOT go out, delete the provisional thread + token
 * so a failed send leaves no empty thread behind. Never throws.
 */
export async function finalizeBulkReplyCapture(
  db: ScopedClient,
  provisioned: Map<string, ProvisionedReply>,
  sent: Map<string, SentReplyRecord>,
): Promise<void> {
  if (provisioned.size === 0) return;

  const sentThreadIds: string[] = [];
  const unsentThreadIds: string[] = [];
  for (const [messageId, p] of provisioned) {
    if (sent.has(messageId)) sentThreadIds.push(p.threadId);
    else unsentThreadIds.push(p.threadId);
  }

  await deleteThreads(db, unsentThreadIds);

  const nowIso = new Date().toISOString();
  for (const part of chunk(sentThreadIds, PROVISION_CHUNK)) {
    try {
      const { error } = await db
        .from("email_threads")
        .update({ message_count: 1, last_message_at: nowIso, updated_at: nowIso })
        .in("id", part);
      if (error) throw new Error(error.message);
    } catch (err) {
      logger.warn({ err }, "reply-capture: failed to mark threads as sent (non-fatal)");
    }
  }

  const records = [...sent.values()];
  for (const part of chunk(records, EMAIL_ROW_CHUNK)) {
    try {
      const { error } = await db.from("emails").insert(
        part.map((r) => ({
          thread_id: r.provisioned.threadId,
          connected_email_account_id: null,
          direction: "outbound",
          provider: "resend",
          provider_message_id: r.providerMessageId,
          from_email: r.fromAddress,
          from_name: r.fromName || null,
          to_emails: [r.toEmail],
          cc_emails: [],
          bcc_emails: [],
          subject: r.provisioned.subject,
          body_html: r.bodyHtml,
          body_text: null,
          gmail_message_id: null,
          // NOT NULL column (migration 025) — see synthetic-message-id.ts
          rfc_message_id: syntheticMessageId(r.providerMessageId),
          in_reply_to: null,
          rfc_references: [],
          sent_at: nowIso,
          sender_user_id: null,
        })),
      );
      if (error) throw new Error(error.message);
    } catch (err) {
      logger.warn({ err }, "reply-capture: failed to record sent emails on threads (non-fatal)");
    }
  }
}

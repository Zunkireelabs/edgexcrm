// Processes verb='fwd' inbound events — a rep hit Reply on the replyable
// passthrough-forwarded copy of a lead's message (docs/email-productionization/
// REPLYABLE-FORWARD-BRIEF.md Stage 2). Structured like bcc-route.ts: the rep
// is the author, so this has its own sender-authenticity guard instead of the
// reply path's thread-authoritative/loop-guard logic, and never forwards or
// notifies (the rep authored this).
//
// Unlike bcc, this path DOES cause EdgeX to send mail: a matched fwd event
// relays the rep's reply to the lead via the rep's own connected mailbox.
// A leaked fwd+ address is strictly more dangerous than a leaked bcc dropbox
// address — it can make EdgeX send real mail to a real lead from a real
// rep's mailbox — so the sender guard (step 1) and the independent token
// status re-check (step 0) are the security core of this module. Fail closed.

import type { GetReceivingEmailResponseSuccess } from "resend";
import type { ScopedClient } from "@/lib/supabase/scoped";
import type { ConnectedEmailAccount } from "@/types/database";
import { normalizeEmail } from "@/lib/leads/dedup";
import { THREAD_COLUMNS, type EmailThreadRow } from "./match-thread";
import { sendMessage } from "@/industries/_shared/features/email/lib/gmail-client";
import { decryptAccountTokens, persistRefreshedToken } from "@/industries/_shared/features/email/lib/token-crypto";
import { mintToken } from "./tokens";
import { sanitizeDisplayName } from "../reply-to-label";
import { logger } from "@/lib/logger";
import {
  getHeader,
  parseAddress,
  extractReferences,
  writeDeadLetter,
  parseSenderVerdict,
  isPlatformSender,
} from "../process-inbound";

export interface FwdRelayParams {
  tenantId: string;
  resendEmailId: string;
  /** events.payload.inbound_address_id — the fwd token's own row id. */
  inboundAddressId: string;
}

interface InboundAddressRow {
  id: string;
  status: string;
  verb: string;
  thread_id: string | null;
}

/**
 * Mints a fresh thread-bound reply token for the relay's Reply-To, mirroring
 * the composer's pre-send wiring (api/v1/email/send/route.ts) so the loop
 * continues — the lead's next reply comes back through the reply+ path, not
 * another fwd+ round-trip. Gated the same way (EDGEX_INBOUND_ENABLED + the
 * tenant's inbound_enabled). Best-effort: never throws, never blocks the
 * relay — a wiring failure here must not turn into a lost reply.
 */
async function mintFreshReplyTo(
  db: ScopedClient,
  threadId: string,
  leadFromName: string | null,
): Promise<string | undefined> {
  if (process.env.EDGEX_INBOUND_ENABLED !== "true") return undefined;
  try {
    const { data: settings } = await db
      .from("tenant_email_settings")
      .select("inbound_enabled")
      .maybeSingle<{ inbound_enabled: boolean }>();
    if (!settings?.inbound_enabled) return undefined;

    const minted = mintToken("reply");
    const { data: addrRow, error: addrErr } = await db
      .from("inbound_addresses")
      .insert({ kind: "thread", verb: "reply", token: minted.token, thread_id: threadId, user_id: null, status: "active" })
      .select("id")
      .single<{ id: string }>();
    if (addrErr || !addrRow) return undefined;

    const label = sanitizeDisplayName(leadFromName);
    return label ? `"${label}" <${minted.address}>` : minted.address;
  } catch (err) {
    logger.warn({ err, threadId }, "fwd relay: fresh reply-to minting failed (non-fatal)");
    return undefined;
  }
}

export async function processFwdRelay(
  p: FwdRelayParams,
  db: ScopedClient,
  receiving: GetReceivingEmailResponseSuccess,
  headers: Record<string, string> | null,
): Promise<void> {
  const fromHeaderRaw = getHeader(headers, "from");
  const fromParsed = fromHeaderRaw ? parseAddress(fromHeaderRaw) : null;
  const fromEmail = fromParsed ? normalizeEmail(fromParsed.email) : null;

  // ── Loop guard: a message genuinely From the platform address can only be
  // a loop — ignore outright, no relay, no dead-letter (this is expected
  // background noise, not a real user action worth ops triage).
  if (isPlatformSender(fromEmail)) return;

  // ── 0. Independent token-status re-check ─────────────────────────────────
  // resolveInboundRecipients() already required status='active' at enqueue
  // time, but this path can send real mail, so it's worth re-verifying here
  // too — an event enqueued just before a revoke must not still relay once
  // drained. thread_id comes from THIS row (the token), never re-derived
  // from In-Reply-To/References.
  const { data: addrRow } = await db
    .from("inbound_addresses")
    .select("id, status, verb, thread_id")
    .eq("id", p.inboundAddressId)
    .maybeSingle<InboundAddressRow>();

  if (!addrRow || addrRow.status !== "active" || addrRow.verb !== "fwd" || !addrRow.thread_id) {
    await writeDeadLetter({
      tenantId: p.tenantId,
      providerMessageId: p.resendEmailId,
      fromAddress: fromHeaderRaw ?? null,
      toAddresses: [],
      subject: receiving.subject ?? null,
      reason: "fwd_token_revoked",
      rawEvent: { headers },
    });
    return;
  }
  const threadId = addrRow.thread_id;

  const { data: threadRow } = await db
    .from("email_threads")
    .select(THREAD_COLUMNS)
    .eq("id", threadId)
    .maybeSingle<EmailThreadRow>();

  let connectedAccount: ConnectedEmailAccount | null = null;
  if (threadRow?.connected_email_account_id) {
    const { data: acct } = await db
      .from("connected_email_accounts")
      .select("*")
      .eq("id", threadRow.connected_email_account_id)
      .maybeSingle<ConnectedEmailAccount>();
    connectedAccount = acct ?? null;
  }

  // ── 1. Sender guard — reuses the bcc-route logic exactly ────────────────
  // Allowed senders = the token owner's login email plus every
  // connected_email_accounts row for that same user_id (OAuth-verified
  // mailbox control, stronger proof than the unverified login address).
  const allowedSenders = new Set<string>();
  if (connectedAccount) {
    const { data: userRes } = await db.raw().auth.admin.getUserById(connectedAccount.user_id);
    const loginEmail = normalizeEmail(userRes?.user?.email ?? null);
    if (loginEmail) allowedSenders.add(loginEmail);

    const { data: accountsData } = await db
      .from("connected_email_accounts")
      .select("email")
      .eq("user_id", connectedAccount.user_id);
    const accounts = (accountsData ?? []) as unknown as Array<{ email: string }>;
    for (const acct of accounts) {
      const normalized = normalizeEmail(acct.email);
      if (normalized) allowedSenders.add(normalized);
    }
  }

  if (!fromParsed || !fromEmail || !connectedAccount || !allowedSenders.has(fromEmail)) {
    await writeDeadLetter({
      tenantId: p.tenantId,
      providerMessageId: p.resendEmailId,
      fromAddress: fromHeaderRaw ?? null,
      toAddresses: [],
      subject: receiving.subject ?? null,
      reason: "fwd_sender_mismatch",
      rawEvent: { headers, allowed_sender_count: allowedSenders.size },
    });
    return;
  }

  // ── 2. Relay target — the most recent inbound message on this thread ────
  // (i.e. the lead's own reply address), not thread.lead_id -> leads.email,
  // which can drift from the address that actually emailed.
  const { data: lastInbound } = await db
    .from("emails")
    .select("from_email, from_name")
    .eq("thread_id", threadId)
    .eq("direction", "inbound")
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ from_email: string; from_name: string | null }>();

  const leadEmail = lastInbound?.from_email ? normalizeEmail(lastInbound.from_email) : null;
  if (!leadEmail) {
    await writeDeadLetter({
      tenantId: p.tenantId,
      providerMessageId: p.resendEmailId,
      fromAddress: fromEmail,
      toAddresses: [],
      subject: receiving.subject ?? null,
      reason: "fwd_no_recipient",
      rawEvent: { headers },
    });
    return;
  }

  const inReplyTo = getHeader(headers, "in-reply-to")?.trim() || null;
  const references = extractReferences(getHeader(headers, "references"));
  const messageId = getHeader(headers, "message-id") ?? null;
  const sentAt = getHeader(headers, "date") ?? receiving.created_at;

  // ── 3. Insert the emails row BEFORE the relay send ───────────────────────
  // A crash between the two must leave a recorded-but-unsent message
  // (visible, recoverable), never a sent-but-unrecorded one (invisible, and
  // indistinguishable from the bug this slice fixes). provider_message_id is
  // UNIQUE — a redelivered webhook hits 23505 here and never reaches the
  // relay send below, so this also is the double-send guard.
  const { data: emailRow, error: insertErr } = await db
    .from("emails")
    .insert({
      thread_id: threadId,
      connected_email_account_id: connectedAccount.id,
      direction: "outbound",
      provider: "edgex_native",
      provider_message_id: p.resendEmailId,
      inbound_route: "fwd",
      from_email: fromEmail,
      from_name: fromParsed.name,
      to_emails: [leadEmail],
      cc_emails: [],
      bcc_emails: [],
      subject: receiving.subject,
      body_html: receiving.html,
      body_text: receiving.text,
      gmail_message_id: null,
      rfc_message_id: messageId,
      in_reply_to: inReplyTo,
      rfc_references: references,
      received_at: null,
      sent_at: sentAt,
      sender_user_id: connectedAccount.user_id,
      attachments: receiving.attachments ?? [],
      sender_verdict: parseSenderVerdict(headers),
    })
    .select("id")
    .single<{ id: string }>();

  if (insertErr) {
    // idx_emails_provider_dedup unique violation -> already processed (webhook redelivery)
    if (insertErr.code === "23505") return;
    throw new Error(`Failed to insert fwd relay emails row: ${insertErr.message}`);
  }
  if (!emailRow) {
    throw new Error("emails insert for fwd relay returned no row");
  }

  await db
    .from("email_threads")
    .update({
      message_count: (threadRow?.message_count ?? 0) + 1,
      last_message_at: receiving.created_at,
      updated_at: new Date().toISOString(),
    })
    .eq("id", threadId);

  // ── 4. Relay to the lead via sendMessage() — the same primitive the
  // composer uses, so the relayed message gets a fresh reply+ token and the
  // loop continues. Strip-quoted-history is deliberately out of scope here.
  let account: ConnectedEmailAccount;
  try {
    account = decryptAccountTokens(connectedAccount);
  } catch (err) {
    await writeDeadLetter({
      tenantId: p.tenantId,
      providerMessageId: p.resendEmailId,
      fromAddress: fromEmail,
      toAddresses: [leadEmail],
      subject: receiving.subject ?? null,
      reason: "fwd_relay_failed",
      rawEvent: { error: err instanceof Error ? err.message : String(err) },
    });
    return;
  }

  const replyTo = await mintFreshReplyTo(db, threadId, lastInbound?.from_name ?? null);

  try {
    const result = await sendMessage(account, {
      from: account.email,
      fromName: account.display_name ?? undefined,
      to: [leadEmail],
      subject: receiving.subject ?? "",
      bodyHtml: receiving.html ?? "",
      bodyText: receiving.text ?? undefined,
      inReplyTo: inReplyTo ?? undefined,
      references: references.length > 0 ? references : undefined,
      replyTo,
    });
    if (result.refreshed_credentials) {
      void persistRefreshedToken(db.raw(), account.id, result.refreshed_credentials);
    }
  } catch (err) {
    logger.error({ err, thread_id: threadId }, "fwd relay: sendMessage failed");
    await writeDeadLetter({
      tenantId: p.tenantId,
      providerMessageId: p.resendEmailId,
      fromAddress: fromEmail,
      toAddresses: [leadEmail],
      subject: receiving.subject ?? null,
      reason: "fwd_relay_failed",
      rawEvent: { error: err instanceof Error ? err.message : String(err) },
    });
  }
}

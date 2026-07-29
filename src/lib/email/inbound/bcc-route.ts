// Processes verb='bcc' inbound events — the personal, revocable dropbox
// address a rep BCCs on mail they send from their own Gmail client.
// docs/email-productionization/BCC-DROPBOX-BRIEF.md §5 — grounded in a live
// stage spike (brief §2); do not re-derive or "improve" the steps below.
//
// Structurally separate from the reply path in process-inbound.ts: a dropbox
// row is OUTBOUND (the rep is the author), so it never touches the reply
// path's loop/auto guard or thread-authoritative short-circuit — this has
// its own sender-authenticity guard (step 2) instead, and never forwards or
// notifies (steps 8/9), both deliberate.

import type { GetReceivingEmailResponseSuccess } from "resend";
import type { ScopedClient } from "@/lib/supabase/scoped";
import { normalizeEmail, resolveLeadIdentity } from "@/lib/leads/dedup";
import { matchInboundToThread, THREAD_COLUMNS, type EmailThreadRow } from "./match-thread";
import { getInboundDomains } from "./tokens";
import { getHeader, parseAddress, extractReferences, stripSubjectPrefixes, writeDeadLetter } from "../process-inbound";

export interface BccDropboxParams {
  tenantId: string;
  resendEmailId: string;
  userId: string | null;
}

// Splits a raw To:/Cc: header value into individual address strings.
// A naive split(",") breaks on a quoted display name containing a comma
// (`"Doe, John" <john@x.com>, jane@y.com`) — track quote/angle-bracket depth
// so commas inside either are not treated as separators.
function splitAddressList(raw: string | undefined): string[] {
  if (!raw) return [];
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  let angleDepth = 0;
  for (const ch of raw) {
    if (ch === '"') inQuotes = !inQuotes;
    if (!inQuotes) {
      if (ch === "<") angleDepth++;
      if (ch === ">") angleDepth = Math.max(0, angleDepth - 1);
    }
    if (ch === "," && !inQuotes && angleDepth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

export async function processBccDropbox(
  p: BccDropboxParams,
  db: ScopedClient,
  receiving: GetReceivingEmailResponseSuccess,
  headers: Record<string, string> | null,
): Promise<void> {
  const fromHeaderRaw = getHeader(headers, "from");
  const fromParsed = fromHeaderRaw ? parseAddress(fromHeaderRaw) : null;

  const toRaw = splitAddressList(getHeader(headers, "to"));
  const ccRaw = splitAddressList(getHeader(headers, "cc"));

  // ── 2. Sender-authenticity guard — the security core of this slice ──────
  // Without this, anyone holding a leaked dropbox address could inject
  // fabricated "outbound" emails into a tenant's lead timeline — forged
  // history that looks first-party. The token alone is an addressing
  // secret, not proof of authorship.
  let ownerEmail: string | null = null;
  if (p.userId) {
    const { data: userRes } = await db.raw().auth.admin.getUserById(p.userId);
    ownerEmail = normalizeEmail(userRes?.user?.email ?? null);
  }

  if (!ownerEmail || !fromParsed || normalizeEmail(fromParsed.email) !== ownerEmail) {
    await writeDeadLetter({
      tenantId: p.tenantId,
      providerMessageId: p.resendEmailId,
      fromAddress: fromHeaderRaw ?? null,
      toAddresses: toRaw,
      subject: receiving.subject ?? null,
      reason: "bcc_sender_mismatch",
      rawEvent: { headers },
    });
    return;
  }

  // ── 3. Recipients — parse To/Cc headers, discard our own dropbox domain ──
  // Never lead-match against our own dropbox address (it lands in to/cc on
  // some clients — brief §2's "one trap").
  const inboundDomains = getInboundDomains();
  const isOwnDomain = (email: string) => {
    const domain = email.includes("@") ? email.split("@")[1] : "";
    return domain !== "" && inboundDomains.includes(domain);
  };

  const toAddresses = toRaw.map(parseAddress);
  const ccAddresses = ccRaw.map(parseAddress);
  const candidateRecipients = [...toAddresses, ...ccAddresses].filter((a) => !isOwnDomain(a.email));

  // ── 4. Lead match — first match in header order, deterministic ──────────
  // Lead auto-create is a later, opt-in slice — no match here is a dead-letter,
  // never a new lead.
  let leadId: string | null = null;
  for (const candidate of candidateRecipients) {
    const identity = await resolveLeadIdentity(db.raw(), {
      tenantId: p.tenantId,
      normalizedEmail: normalizeEmail(candidate.email),
      normalizedPhone: null,
    });
    if (identity.match === "email" && identity.existingLead) {
      leadId = identity.existingLead.id;
      break;
    }
  }

  if (!leadId) {
    await writeDeadLetter({
      tenantId: p.tenantId,
      providerMessageId: p.resendEmailId,
      fromAddress: fromParsed.email,
      toAddresses: toRaw,
      subject: receiving.subject ?? null,
      reason: "bcc_no_lead_match",
      rawEvent: { headers },
    });
    return;
  }

  // ── 5. Skip an EdgeX-sent copy — the rep BCC'd a message EdgeX itself sent ─
  const messageId = getHeader(headers, "message-id") ?? null;
  if (messageId) {
    const { data: existing } = await db
      .from("emails")
      .select("id")
      .eq("rfc_message_id", messageId)
      .maybeSingle<{ id: string }>();
    if (existing) return; // not an error, not a dead-letter — no second row
  }

  // ── 6. Thread — no accountId/gmailThreadId (Resend-inbound never has one) ─
  const inReplyTo = getHeader(headers, "in-reply-to")?.trim() || null;
  const references = extractReferences(getHeader(headers, "references"));

  let thread: EmailThreadRow | null = await matchInboundToThread(db.raw(), {
    tenantId: p.tenantId,
    inReplyTo,
    references,
  });

  if (!thread) {
    const { data: newThread, error: threadErr } = await db
      .from("email_threads")
      .insert({
        provider: "edgex_native",
        connected_email_account_id: null,
        gmail_thread_id: null,
        lead_id: leadId,
        contact_id: null,
        subject: stripSubjectPrefixes(receiving.subject ?? ""),
        last_message_at: receiving.created_at,
        message_count: 0,
      })
      .select(THREAD_COLUMNS)
      .single<EmailThreadRow>();

    if (threadErr || !newThread) {
      throw new Error(`Failed to create email_threads row for bcc dropbox mail: ${threadErr?.message}`);
    }
    thread = newThread;
  }

  // ── 7. Insert the email — outbound, authored by the rep ──────────────────
  const sentAt = getHeader(headers, "date") ?? receiving.created_at;

  const { data: emailRow, error: insertErr } = await db
    .from("emails")
    .insert({
      thread_id: thread.id,
      connected_email_account_id: thread.connected_email_account_id,
      direction: "outbound",
      provider: "edgex_native",
      provider_message_id: p.resendEmailId,
      inbound_route: "bcc",
      from_email: fromParsed.email,
      from_name: fromParsed.name,
      to_emails: toAddresses.map((a) => a.email),
      cc_emails: ccAddresses.map((a) => a.email),
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
      sender_user_id: p.userId,
      attachments: receiving.attachments ?? [],
    })
    .select("id")
    .single<{ id: string }>();

  if (insertErr) {
    // idx_emails_provider_dedup unique violation -> already processed (webhook redelivery)
    if (insertErr.code === "23505") return;
    throw new Error(`Failed to insert bcc dropbox emails row: ${insertErr.message}`);
  }
  if (!emailRow) {
    throw new Error("emails insert for bcc dropbox mail returned no row");
  }

  await db
    .from("email_threads")
    .update({
      message_count: thread.message_count + 1,
      last_message_at: receiving.created_at,
      updated_at: new Date().toISOString(),
    })
    .eq("id", thread.id);

  // ── 8. Do NOT forward. The rep is the author and already has this message
  // in their own Sent folder — forwardReceivingEmail() would mail them a copy
  // of their own email. Do not "fix" this by adding it back.
  //
  // ── 9. Do NOT notify. upsertThreadNotification() exists for the OTHER
  // party's reply arriving — a bell for the rep's own sent mail is noise.
}

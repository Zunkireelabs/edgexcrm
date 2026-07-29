// Async inbound processor for the Resend-native email spine — drained by
// src/app/api/internal/email/inbound/process/route.ts and the Inngest fn
// ops-email-inbound-process. Structural clone of src/lib/inbox/process-inbound.ts:
//   pending `events` (type='email.inbound_received') -> per-event try/catch ->
//   attempts/status, retry-to-failed at 3.
//
// Threading algorithm (brief §9), in order:
//   1. Loop/auto guard FIRST, before any write -> dead-letter on trip.
//   2. verb==='reply' with a thread_id -> that thread, full stop (authoritative).
//   3. In-Reply-To -> tenant-scoped match-thread.ts.
//   4. References (reversed) -> tenant-scoped match-thread.ts.
//   5. No thread -> create one (provider='edgex_native'), lead_id via the
//      email branch of resolveLeadIdentity() (single match only, else NULL).
//   6. No subject-similarity fallback — ever (classic cause of merging
//      unrelated threads).

import { createServiceClient } from "@/lib/supabase/server";
import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { logger } from "@/lib/logger";
import { emitEvent } from "@/lib/api/audit";
import { upsertThreadNotification, NotificationTypes } from "@/lib/notifications";
import { normalizeEmail, resolveLeadIdentity } from "@/lib/leads/dedup";
import { matchInboundToThread, THREAD_COLUMNS, type EmailThreadRow } from "./inbound/match-thread";
import { getReceivingEmail, forwardReceivingEmail } from "./inbound/resend-client";
import { PLATFORM_EMAIL_ADDRESS } from "./index";
import { getInboundDomains, type InboundVerb } from "./inbound/tokens";
import { processBccDropbox } from "./inbound/bcc-route";

interface InboundEnvelope {
  to: string[];
  cc: string[];
  bcc: string[];
  from: string;
  subject: string;
}

interface InboundEmailEventPayload {
  resend_email_id: string;
  tenant_id: string;
  inbound_address_id: string;
  kind: "thread" | "user" | "tenant";
  verb: InboundVerb;
  thread_id: string | null;
  user_id: string | null;
  envelope: InboundEnvelope;
}

interface EventRow {
  id: string;
  tenant_id: string;
  payload: InboundEmailEventPayload;
}

interface ProcessResult {
  processed: number;
  skipped: number;
  errors: number;
}

export async function processInboundEmailEvents(limit = 50): Promise<ProcessResult> {
  const supabase = await createServiceClient();
  let processed = 0;
  const skipped = 0;
  let errors = 0;

  const { data: events, error: fetchErr } = await supabase
    .from("events")
    .select("id, tenant_id, payload")
    .eq("type", "email.inbound_received")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (fetchErr) {
    logger.error({ err: fetchErr }, "processInboundEmailEvents: failed to fetch events");
    return { processed: 0, skipped: 0, errors: 1 };
  }

  if (!events || events.length === 0) {
    return { processed: 0, skipped: 0, errors: 0 };
  }

  for (const evt of events as EventRow[]) {
    try {
      await processOneEvent(evt);
      await supabase.from("events").update({ status: "completed" }).eq("id", evt.id);
      processed++;
    } catch (err) {
      errors++;
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error({ err, eventId: evt.id }, "processInboundEmailEvents: failed to process event");
      const { data: current } = await supabase.from("events").select("attempts").eq("id", evt.id).single();
      const attempts = ((current as { attempts?: number } | null)?.attempts ?? 0) + 1;
      await supabase
        .from("events")
        .update({
          last_error: errMsg,
          attempts,
          status: attempts >= 3 ? "failed" : "pending",
        })
        .eq("id", evt.id);
    }
  }

  return { processed, skipped, errors };
}

// ── RFC822 helpers (headers come back already-parsed key/value from Resend) ──

export function getHeader(headers: Record<string, string> | null, name: string): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

export function parseAddress(raw: string): { email: string; name: string | null } {
  const match = raw.match(/^"?([^"<>]+?)"?\s*<([^>]+)>$/);
  if (match) return { name: match[1].trim() || null, email: match[2].trim().toLowerCase() };
  return { name: null, email: raw.trim().toLowerCase() };
}

export function extractReferences(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.match(/<[^>]+>/g) ?? [];
}

export function stripSubjectPrefixes(subject: string): string {
  let s = subject.trim();
  let prev: string;
  do {
    prev = s;
    s = s.replace(/^(re|fwd?|fw)\s*:\s*/i, "").trim();
  } while (s !== prev);
  return s;
}

function parseSenderVerdict(headers: Record<string, string> | null): Record<string, string> | null {
  const authResults = getHeader(headers, "Authentication-Results");
  if (!authResults) return null;
  const verdict: Record<string, string> = {};
  const spf = authResults.match(/\bspf=(\w+)/i);
  const dkim = authResults.match(/\bdkim=(\w+)/i);
  const dmarc = authResults.match(/\bdmarc=(\w+)/i);
  if (spf) verdict.spf = spf[1].toLowerCase();
  if (dkim) verdict.dkim = dkim[1].toLowerCase();
  if (dmarc) verdict.dmarc = dmarc[1].toLowerCase();
  return Object.keys(verdict).length > 0 ? verdict : null;
}

export async function writeDeadLetter(params: {
  tenantId: string | null;
  providerMessageId: string | null;
  fromAddress: string | null;
  toAddresses: string[];
  subject: string | null;
  reason: string;
  rawEvent: unknown;
}): Promise<void> {
  const supabase = await createServiceClient();
  const { error } = await supabase.from("inbound_email_dead_letter").insert({
    tenant_id: params.tenantId,
    provider_message_id: params.providerMessageId,
    from_address: params.fromAddress,
    to_addresses: params.toAddresses,
    subject: params.subject,
    reason: params.reason,
    raw_event: params.rawEvent as Record<string, unknown>,
  });
  // provider_message_id is UNIQUE — a redelivered/duplicate event is a no-op, not an error.
  if (error && error.code !== "23505") {
    logger.error({ err: error, reason: params.reason }, "writeDeadLetter failed");
  }
}

async function processOneEvent(evt: EventRow): Promise<void> {
  const p = evt.payload;
  if (!p.resend_email_id || !p.tenant_id) {
    throw new Error("Invalid email.inbound_received payload: missing required fields");
  }

  // Post-resolution writes use scopedClientForTenant — the tenant filter is
  // structural (auto-applied to every query) rather than remembered (brief §8).
  const db = await scopedClientForTenant(p.tenant_id);

  const receiving = await getReceivingEmail(p.resend_email_id);
  const { email: fromEmail, name: fromName } = parseAddress(receiving.from);
  const headers = receiving.headers;

  // Dropbox mail (verb='bcc') is a structurally different flow — the rep is
  // the author, not a lead replying — so it never touches the reply-path
  // loop/auto guard or thread-authoritative logic below. It has its own
  // sender-authenticity guard instead (bcc-route.ts §5 step 2). The reply
  // path from here down is otherwise untouched.
  if (p.verb === "bcc") {
    await processBccDropbox({ tenantId: p.tenant_id, resendEmailId: p.resend_email_id, userId: p.user_id }, db, receiving, headers);
    return;
  }

  // ── 1. Loop/auto guard FIRST, before any write ──────────────────────────
  const autoSubmittedHeader = getHeader(headers, "Auto-Submitted");
  const isAutoSubmitted = !!autoSubmittedHeader && autoSubmittedHeader.trim().toLowerCase() !== "no";
  const precedence = getHeader(headers, "Precedence")?.trim().toLowerCase();
  const isBulkPrecedence = precedence === "bulk" || precedence === "auto_reply" || precedence === "list";
  const hasAutoreplyHeader =
    getHeader(headers, "X-Autoreply") !== undefined || getHeader(headers, "X-Autorespond") !== undefined;
  const hasListId = getHeader(headers, "List-Id") !== undefined;

  const { data: tenantSettings } = await db
    .from("tenant_email_settings")
    .select("from_address")
    .maybeSingle<{ from_address: string | null }>();
  const tenantFromAddress = normalizeEmail(tenantSettings?.from_address ?? null);

  let inboundDomains: string[];
  try {
    inboundDomains = getInboundDomains();
  } catch {
    inboundDomains = [];
  }
  const fromDomain = fromEmail.includes("@") ? fromEmail.split("@")[1] : "";
  const isFromInboundDomain = fromDomain !== "" && inboundDomains.includes(fromDomain);
  const isFromPlatform = fromEmail === normalizeEmail(PLATFORM_EMAIL_ADDRESS);
  const isFromTenantSender = tenantFromAddress !== null && fromEmail === tenantFromAddress;

  if (
    isAutoSubmitted ||
    isBulkPrecedence ||
    hasAutoreplyHeader ||
    hasListId ||
    isFromPlatform ||
    isFromInboundDomain ||
    isFromTenantSender
  ) {
    await writeDeadLetter({
      tenantId: p.tenant_id,
      providerMessageId: p.resend_email_id,
      fromAddress: receiving.from,
      toAddresses: receiving.to,
      subject: receiving.subject,
      reason: "auto_submitted",
      rawEvent: { headers, envelope: p.envelope },
    });
    return;
  }

  const inReplyTo = getHeader(headers, "In-Reply-To")?.trim() || null;
  const references = extractReferences(getHeader(headers, "References"));

  // ── 2. verb==='reply' with a thread_id: authoritative, full stop ────────
  let thread: EmailThreadRow | null = null;

  if (p.verb === "reply" && p.thread_id) {
    const { data: row } = await db
      .from("email_threads")
      .select(THREAD_COLUMNS)
      .eq("id", p.thread_id)
      .maybeSingle<EmailThreadRow>();
    if (row) {
      // Structurally guaranteed by scopedClientForTenant (select() only ever
      // returns tenant_id === p.tenant_id rows) — kept as an explicit assert
      // per brief §9 defense-in-depth, in case this ever gets refactored onto
      // a raw client.
      if (row.tenant_id !== p.tenant_id) {
        throw new Error(
          `cross-tenant thread lookup: thread ${row.id} belongs to ${row.tenant_id}, event tenant is ${p.tenant_id}`,
        );
      }
      thread = row;
    }
  }

  // ── 3/4. In-Reply-To, then References — tenant-scoped fallbacks ─────────
  if (!thread) {
    thread = await matchInboundToThread(db.raw(), { tenantId: p.tenant_id, inReplyTo, references });
  }

  // ── 5. No thread found -> create one. No subject-similarity fallback ────
  if (!thread) {
    const normalizedEmail = normalizeEmail(receiving.from);
    const identity = await resolveLeadIdentity(db.raw(), {
      tenantId: p.tenant_id,
      normalizedEmail,
      normalizedPhone: null,
    });
    const leadId = identity.match === "email" ? (identity.existingLead?.id ?? null) : null;

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
      throw new Error(`Failed to create email_threads row for inbound mail: ${threadErr?.message}`);
    }
    thread = newThread;
  }

  const attachments = receiving.attachments ?? [];
  const senderVerdict = parseSenderVerdict(headers);

  const { data: emailRow, error: insertErr } = await db
    .from("emails")
    .insert({
      thread_id: thread.id,
      connected_email_account_id: thread.connected_email_account_id,
      direction: "inbound",
      provider: "edgex_native",
      provider_message_id: p.resend_email_id,
      inbound_route: p.verb,
      from_email: fromEmail,
      from_name: fromName,
      to_emails: receiving.to,
      cc_emails: receiving.cc ?? [],
      bcc_emails: receiving.bcc ?? [],
      subject: receiving.subject,
      body_html: receiving.html,
      body_text: receiving.text,
      gmail_message_id: null,
      rfc_message_id: receiving.message_id,
      in_reply_to: inReplyTo,
      rfc_references: references,
      received_at: receiving.created_at,
      sent_at: null,
      sender_user_id: null,
      attachments,
      sender_verdict: senderVerdict,
    })
    .select("id")
    .single<{ id: string }>();

  if (insertErr) {
    // idx_emails_provider_dedup unique violation -> already processed (webhook redelivery)
    if (insertErr.code === "23505") return;
    throw new Error(`Failed to insert inbound emails row: ${insertErr.message}`);
  }
  if (!emailRow) {
    throw new Error("emails insert for inbound mail returned no row");
  }

  await db
    .from("email_threads")
    .update({
      message_count: thread.message_count + 1,
      last_message_at: receiving.created_at,
      updated_at: new Date().toISOString(),
    })
    .eq("id", thread.id);

  await emitEvent({
    tenantId: p.tenant_id,
    type: "email.received",
    entityType: "email",
    entityId: emailRow.id,
    payload: {
      thread_id: thread.id,
      lead_id: thread.lead_id,
      contact_id: thread.contact_id,
      from_email: fromEmail,
      subject: receiving.subject,
      received_at: receiving.created_at,
      provider: "edgex_native",
    },
  });

  // Connected-account context (only threads that started life as a Gmail send
  // carry one) — used both for the notification recipient and the tail
  // passthrough-forward step below.
  let connectedAccount: { user_id: string; email: string } | null = null;
  if (thread.connected_email_account_id) {
    const { data: acct } = await db
      .from("connected_email_accounts")
      .select("user_id, email")
      .eq("id", thread.connected_email_account_id)
      .maybeSingle<{ user_id: string; email: string }>();
    connectedAccount = acct ?? null;
  }

  try {
    const recipientIds = new Set<string>();
    if (connectedAccount) recipientIds.add(connectedAccount.user_id);

    if (thread.lead_id) {
      const { data: leadRow } = await db
        .from("leads")
        .select("assigned_to")
        .eq("id", thread.lead_id)
        .maybeSingle<{ assigned_to: string | null }>();
      const assignedTo = leadRow?.assigned_to;
      if (assignedTo) recipientIds.add(assignedTo);
    }

    if (recipientIds.size > 0) {
      const senderLabel = fromName || fromEmail;
      const subjectLabel = receiving.subject || "(no subject)";
      const link = thread.lead_id ? `/leads/${thread.lead_id}` : undefined;

      await Promise.all(
        Array.from(recipientIds).map((userId) =>
          upsertThreadNotification({
            tenantId: p.tenant_id,
            userId,
            type: NotificationTypes.EMAIL_RECEIVED,
            title: "New email reply",
            message: `${senderLabel}: ${subjectLabel}`,
            link,
          }),
        ),
      );
    }
  } catch (notifyErr) {
    logger.warn({ err: notifyErr, thread_id: thread.id }, "Failed to create email.received notification (non-fatal)");
  }

  // Tail step: passthrough-forward to the rep's Gmail so they still see the
  // reply where they expect it (accepted trade-off — brief intro).
  if (connectedAccount) {
    await forwardReceivingEmail({
      emailId: p.resend_email_id,
      to: connectedAccount.email,
      from: PLATFORM_EMAIL_ADDRESS,
    });
  }
}

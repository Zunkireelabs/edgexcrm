import type { AuthContext } from "@/lib/api/auth";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import { shouldLeadBeVisibleToAssignee } from "@/lib/leads/branch-membership";
import {
  apiError,
  apiForbidden,
  apiInternalError,
  apiNotFound,
  apiServiceUnavailable,
  apiSuccess,
  apiValidationError,
} from "@/lib/api/response";
import { emitEvent } from "@/lib/api/audit";
import { logger } from "@/lib/logger";
import { scopedClient, type ScopedClient } from "@/lib/supabase/scoped";
import { getResendClient } from "./index";
import { resolveVerifiedCompanySender, type VerifiedCompanySender } from "./sender";
import { resolveNoReplySender } from "./no-reply-sender";
import { renderBrandedMessage, type BrandedBrand } from "./template/branded-message";
import { NO_REPLY_SENDER_ID } from "./company-sender-id";
import { mintToken, getInboundDomains } from "./inbound/tokens";
import { sanitizeDisplayName } from "./reply-to-label";
import { syntheticMessageId, isSyntheticMessageId } from "./synthetic-message-id";
import { applyEmailEnvGuard } from "./outbound/env-guard";
import { loadSuppressedEmails, normalizeEmail } from "./outbound/suppression";
import { acquireResendRateLimitSlot } from "./outbound/rate-limit";
import { getEmailTransportMode, sendStubEmail } from "./outbound/transport";
import { isReplyCaptureEnabled } from "./outbound/reply-capture";

// POST /api/v1/email/send with from_account_id === "company" (or "no-reply") lands here.
//
// "no-reply" is the tenant's second address on the same verified domain: same path, same safety nets, but the message is wrapped in
// the branded layout (logo, colour bar, footer) when it is SENT. What is stored on the thread is the message as typed.
//
// A person writing a ONE-OFF email from the lead page, sent from the tenant's
// verified company address (e.g. hello@mail.admizz.com) instead of their own
// Gmail. Deliberately a separate module from the Gmail path in the route: the
// Gmail path is untouched, and nothing in here runs unless "company" was chosen.
//
// Differences from bulk sends (outbound/send.ts): this is a 1:1 message, so no
// marketing unsubscribe footer / bulk headers and no daily-cap accounting — it is
// already rate-limited per user by the route. It DOES go through the same safety
// nets as every other outbound email: the sandbox recipient-redirect guard, the
// suppression list, the transport seam (stub on stage) and the Resend pacing slot.

const MAX_RECIPIENTS = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;

function isStringArray(val: unknown): val is string[] {
  return Array.isArray(val) && val.every((v) => typeof v === "string");
}

/** Accepts `a@b.com` or `Name <a@b.com>` (what you get pasting from a mail client). */
function cleanAddress(raw: string): string {
  const angle = raw.match(/<([^>]+)>/);
  return (angle ? angle[1] : raw).trim();
}

/** Same rule as the Gmail path: our own inbound-domain addresses are never persisted in bcc_emails. */
function filterOwnDomainsForPersistence(bcc: string[]): string[] {
  let domains: string[];
  try {
    domains = getInboundDomains();
  } catch {
    return bcc;
  }
  return bcc.filter((addr) => {
    const at = addr.lastIndexOf("@");
    const domain = at === -1 ? "" : addr.slice(at + 1).toLowerCase();
    return domain === "" || !domains.includes(domain);
  });
}

/** Best-effort rollback of pre-send inbound wiring. Never throws. */
async function cleanupProvisional(
  db: ScopedClient,
  ids: { mintedAddressId: string | null; provisionalThreadId: string | null },
): Promise<void> {
  try {
    if (ids.mintedAddressId) await db.from("inbound_addresses").delete().eq("id", ids.mintedAddressId);
    if (ids.provisionalThreadId) await db.from("email_threads").delete().eq("id", ids.provisionalThreadId);
  } catch (err) {
    logger.warn({ err }, "company-send: failed to clean up provisional inbound artifacts (non-fatal)");
  }
}

interface ReplyThread {
  id: string;
  message_count: number;
  lead_id: string | null;
  contact_id: string | null;
}

export async function handleCompanySend(auth: AuthContext, body: Body): Promise<Response> {
  // ── 1. Recipients ──────────────────────────────────────────────────────────
  if (!isStringArray(body.to) || body.to.length === 0) {
    return apiValidationError({ to: ["to must be a non-empty array of email addresses"] });
  }
  if ((body.cc !== undefined && !isStringArray(body.cc)) || (body.bcc !== undefined && !isStringArray(body.bcc))) {
    return apiValidationError({ cc: ["cc and bcc must be arrays of email addresses"] });
  }
  const toList = (body.to as string[]).map(cleanAddress).filter(Boolean);
  const ccList = ((body.cc ?? []) as string[]).map(cleanAddress).filter(Boolean);
  const bccList = ((body.bcc ?? []) as string[]).map(cleanAddress).filter(Boolean);
  const allRecipients = [...toList, ...ccList, ...bccList];
  const bad = allRecipients.find((a) => !EMAIL_RE.test(a));
  if (bad) return apiValidationError({ to: [`"${bad}" is not a valid email address`] });
  if (toList.length === 0) return apiValidationError({ to: ["to must be a non-empty array of email addresses"] });
  if (allRecipients.length > MAX_RECIPIENTS) {
    return apiValidationError({ to: [`At most ${MAX_RECIPIENTS} recipients per email from the company address`] });
  }

  // ── 2. The company sender (or the no-reply one) must exist and be verified ─
  const isNoReply = body.from_account_id === NO_REPLY_SENDER_ID;
  // The no-reply address is for one-way information emails. It never answers a message: a reply goes from the company address.
  if (isNoReply && body.reply_context) {
    return apiValidationError({ from_account_id: ["The no-reply address can't be used to reply. Reply from the company address."] });
  }

  let sender: VerifiedCompanySender;
  let brand: BrandedBrand | null = null;
  if (isNoReply) {
    const noReply = await resolveNoReplySender(auth.tenantId);
    if (!noReply) {
      return apiError(
        "NO_REPLY_SENDER_UNAVAILABLE",
        "The no-reply address isn't set up yet. Ask an admin to add it in Settings → Communications.",
        400,
      );
    }
    sender = noReply.sender;
    brand = noReply.brand;
  } else {
    const company = await resolveVerifiedCompanySender(auth.tenantId);
    if (!company) {
      return apiError(
        "COMPANY_SENDER_UNAVAILABLE",
        "The company email address isn't set up or verified yet. Ask an admin to verify it in Settings → Communications.",
        400,
      );
    }
    sender = company;
  }

  const db = await scopedClient(auth);

  // ── 3. Reply context (optional): only company threads, never someone's Gmail thread ──
  let thread: ReplyThread | null = null;
  let replyInReplyTo: string | undefined;
  let replyReferences: string[] = [];

  if (body.reply_context && typeof body.reply_context === "object") {
    const { thread_id, in_reply_to, references } = body.reply_context;
    if (!thread_id || typeof thread_id !== "string") {
      return apiValidationError({ reply_context: ["reply_context.thread_id is required"] });
    }
    const { data: t } = await db
      .from("email_threads")
      .select("id, message_count, lead_id, contact_id, connected_email_account_id")
      .eq("id", thread_id)
      .maybeSingle<ReplyThread & { connected_email_account_id: string | null }>();
    if (!t) return apiNotFound("Email thread");

    // A thread started from a connected Gmail belongs to that inbox, and a BCC-dropbox thread
    // belongs to a rep's personal mailbox. Only a thread that THIS company address started
    // (no Gmail account, with an outbound Resend message) may be answered from it.
    let isCompanyThread = false;
    if (t.connected_email_account_id === null) {
      const { data: prior } = await db
        .from("emails")
        .select("id")
        .eq("thread_id", t.id)
        .eq("direction", "outbound")
        .eq("provider", "resend")
        .limit(1)
        .maybeSingle<{ id: string }>();
      isCompanyThread = !!prior;
    }
    if (!isCompanyThread) {
      return apiError("REPLY_ACCOUNT_MISMATCH", "Reply must be sent from the thread's original account.", 400);
    }

    thread = { id: t.id, message_count: t.message_count, lead_id: t.lead_id, contact_id: t.contact_id };
    // A synthetic id (our own placeholder for a previous company-sender message) is never put on the wire.
    replyInReplyTo = typeof in_reply_to === "string" && !isSyntheticMessageId(in_reply_to) ? in_reply_to : undefined;
    replyReferences = (isStringArray(references) ? references : []).filter((r) => !isSyntheticMessageId(r));
  }

  // ── 4. Lead / contact: must exist in this tenant and be visible to the sender ─
  const effectiveLeadId: string | null =
    typeof body.lead_id === "string" && body.lead_id ? body.lead_id : (thread?.lead_id ?? null);
  const effectiveContactId: string | null =
    typeof body.contact_id === "string" && body.contact_id ? body.contact_id : (thread?.contact_id ?? null);

  let subject = body.subject as string;
  let bodyHtml = body.body_html as string;

  if (effectiveLeadId) {
    if (shouldRestrictToSelf(auth.permissions)) {
      const visible = await shouldLeadBeVisibleToAssignee(db.raw(), auth.tenantId, effectiveLeadId, auth.userId);
      if (!visible) return apiForbidden();
    }
    const { data: lead } = await db
      .from("leads")
      .select("first_name, last_name")
      .eq("id", effectiveLeadId)
      .is("deleted_at", null)
      .maybeSingle<{ first_name?: string | null; last_name?: string | null }>();
    if (!lead) return apiNotFound("Lead");

    const replace = (s: string) =>
      s
        .replace(/\{\{\s*first_name\s*\}\}/g, lead.first_name ?? "")
        .replace(/\{\{\s*last_name\s*\}\}/g, lead.last_name ?? "");
    subject = replace(subject);
    bodyHtml = replace(bodyHtml);
  }

  if (effectiveContactId) {
    const { data: contact } = (await db
      .from("contacts")
      .select("id, assigned_to")
      .eq("id", effectiveContactId)
      .maybeSingle()) as { data: { id: string; assigned_to: string | null } | null };
    if (!contact) return apiNotFound("Contact");
    if (shouldRestrictToSelf(auth.permissions) && contact.assigned_to !== auth.userId) return apiForbidden();
  }

  // ── 5. Suppression: never email an address that unsubscribed, bounced or complained ──
  try {
    const suppressed = await loadSuppressedEmails(db, auth.tenantId, allRecipients);
    const blocked = allRecipients.find((a) => suppressed.has(normalizeEmail(a)));
    if (blocked) {
      return apiError(
        "RECIPIENT_SUPPRESSED",
        `${blocked} has unsubscribed or their address bounced, so we can't email them.`,
        422,
      );
    }
  } catch (err) {
    // Fail closed: if we can't prove nobody is suppressed, don't send.
    logger.error({ err }, "company-send: suppression check failed");
    return apiServiceUnavailable("Couldn't verify the recipient. Please try again.");
  }

  // ── 6. Environment guard (sandbox redirects recipients; stage never mails real people) ──
  let sendTo = toList;
  let sendCc = ccList;
  let sendBcc = bccList;
  let sendSubject = subject;
  try {
    const guarded = applyEmailEnvGuard(normalizeEmail(toList[0]), subject);
    if (guarded.sandboxed) {
      sendTo = guarded.to;
      sendCc = [];
      sendBcc = [];
      sendSubject = guarded.subject;
    }
  } catch (err) {
    logger.error({ err }, "company-send: environment guard refused to send");
    return apiServiceUnavailable("Email sending isn't configured safely on this environment.");
  }

  // What actually goes out: the message as typed, or (no-reply) the same message inside the branded layout. The stored copy stays
  // the typed message.
  const htmlToSend = brand ? renderBrandedMessage({ bodyHtml, brand, title: sendSubject }) : bodyHtml;

  const transportMode = getEmailTransportMode();
  const resend = transportMode === "resend" ? getResendClient() : null;
  if (transportMode === "resend" && !resend) {
    logger.error("company-send: RESEND_API_KEY not configured");
    return apiServiceUnavailable("Email sending isn't configured.");
  }

  // ── 7. Inbound spine: thread + reply token BEFORE sending, so Reply-To can point back at EdgeX ──
  // Same gating and failure policy as the Gmail path: when off, or if anything here fails, we send with
  // the tenant's configured Reply-To (the team mailbox) exactly as the company sender behaved before.
  let replyTo: string | undefined = sender.replyTo ?? undefined;
  let provisionalThreadId: string | null = null;
  let mintedAddressId: string | null = null;

  if (await isReplyCaptureEnabled(db)) {
    try {
      let targetThreadId = thread?.id ?? null;
      if (!targetThreadId) {
        const { data: newThread, error: threadErr } = await db
          .from("email_threads")
          .insert({
            provider: "edgex_native",
            connected_email_account_id: null,
            gmail_thread_id: null,
            lead_id: effectiveLeadId,
            contact_id: effectiveContactId,
            subject,
            last_message_at: new Date().toISOString(),
            message_count: 0,
          })
          .select("id")
          .single<{ id: string }>();
        if (threadErr || !newThread) throw new Error(`provisional email_threads insert failed: ${threadErr?.message}`);
        targetThreadId = newThread.id;
        provisionalThreadId = newThread.id;
      }

      const minted = mintToken("reply");
      const { data: addrRow, error: addrErr } = await db
        .from("inbound_addresses")
        .insert({
          kind: "thread",
          verb: "reply",
          token: minted.token,
          thread_id: targetThreadId,
          user_id: null,
          status: "active",
        })
        .select("id")
        .single<{ id: string }>();
      if (addrErr || !addrRow) throw new Error(`inbound_addresses insert failed: ${addrErr?.message}`);
      mintedAddressId = addrRow.id;

      const label = sanitizeDisplayName(sender.name);
      replyTo = label ? `"${label}" <${minted.address}>` : minted.address;
    } catch (err) {
      logger.error({ err }, "company-send: inbound wiring failed — sending with the tenant Reply-To");
      await cleanupProvisional(db, { mintedAddressId, provisionalThreadId });
      replyTo = sender.replyTo ?? undefined;
      mintedAddressId = null;
      provisionalThreadId = null;
    }
  }

  // ── 8. Send ────────────────────────────────────────────────────────────────
  let providerMessageId: string;
  try {
    if (transportMode === "stub") {
      providerMessageId = sendStubEmail({ to: sendTo, from: sender.from, subject: sendSubject, html: htmlToSend }).data.id;
    } else {
      await acquireResendRateLimitSlot();
      const headers: Record<string, string> = {};
      if (replyInReplyTo) headers["In-Reply-To"] = replyInReplyTo;
      if (replyReferences.length > 0) headers["References"] = replyReferences.join(" ");

      const { data, error: sendError } = await resend!.emails.send({
        from: sender.from,
        to: sendTo,
        ...(sendCc.length > 0 ? { cc: sendCc } : {}),
        ...(sendBcc.length > 0 ? { bcc: sendBcc } : {}),
        ...(replyTo ? { replyTo } : {}),
        subject: sendSubject,
        html: htmlToSend,
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      });
      if (sendError || !data?.id) throw new Error(sendError?.message ?? "Resend returned no message id");
      providerMessageId = data.id;
    }
  } catch (err) {
    logger.error({ err }, "company-send: send failed");
    // Nothing was delivered — undo the provisional thread / token so a failed send leaves no trace.
    await cleanupProvisional(db, { mintedAddressId, provisionalThreadId });
    return apiServiceUnavailable("Failed to send the email. Please try again.");
  }

  // ── 9. Persist (only now that the provider accepted it) ────────────────────
  const nowIso = new Date().toISOString();
  let threadId: string;

  if (thread) {
    threadId = thread.id;
    await db
      .from("email_threads")
      .update({ message_count: thread.message_count + 1, last_message_at: nowIso, updated_at: nowIso })
      .eq("id", thread.id);
  } else if (provisionalThreadId) {
    threadId = provisionalThreadId;
    await db
      .from("email_threads")
      .update({ message_count: 1, last_message_at: nowIso, updated_at: nowIso })
      .eq("id", provisionalThreadId);
  } else {
    const { data: newThread, error: threadErr } = await db
      .from("email_threads")
      .insert({
        provider: "edgex_native",
        connected_email_account_id: null,
        gmail_thread_id: null,
        lead_id: effectiveLeadId,
        contact_id: effectiveContactId,
        subject,
        last_message_at: nowIso,
        message_count: 1,
      })
      .select("id")
      .single<{ id: string }>();
    if (threadErr || !newThread) {
      logger.error({ threadErr, providerMessageId }, "company-send: email_threads insert failed after a successful send");
      return apiInternalError();
    }
    threadId = newThread.id;
  }

  const { data: email, error: emailErr } = await db
    .from("emails")
    .insert({
      thread_id: threadId,
      connected_email_account_id: null,
      direction: "outbound",
      provider: "resend",
      provider_message_id: providerMessageId,
      from_email: sender.address,
      from_name: sender.name,
      to_emails: toList,
      cc_emails: ccList,
      bcc_emails: filterOwnDomainsForPersistence(bccList),
      subject,
      body_html: bodyHtml,
      body_text: null,
      gmail_message_id: null,
      // NOT NULL column (migration 025) — see synthetic-message-id.ts
      rfc_message_id: syntheticMessageId(providerMessageId),
      in_reply_to: replyInReplyTo ?? null,
      rfc_references: replyReferences,
      sent_at: nowIso,
      sender_user_id: auth.userId,
    })
    .select("id")
    .single<{ id: string }>();
  if (emailErr || !email) {
    logger.error({ emailErr, thread_id: threadId }, "company-send: emails insert failed after a successful send");
    return apiInternalError();
  }

  await emitEvent({
    tenantId: auth.tenantId,
    type: "email.sent",
    entityType: "email",
    entityId: email.id,
    payload: {
      thread_id: threadId,
      is_reply: !!thread,
      lead_id: effectiveLeadId,
      contact_id: effectiveContactId,
      subject,
      from_account_id: isNoReply ? NO_REPLY_SENDER_ID : "company",
      sender_user_id: auth.userId,
      to_emails: toList,
    },
  });

  return apiSuccess({ thread_id: threadId, email_id: email.id, gmail_message_id: null });
}

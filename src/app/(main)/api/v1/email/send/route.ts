import { authenticateRequest } from "@/lib/api/auth";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import { shouldLeadBeVisibleToAssignee } from "@/lib/leads/branch-membership";
import {
  apiUnauthorized,
  apiForbidden,
  apiSuccess,
  apiInternalError,
  apiValidationError,
  apiServiceUnavailable,
  apiNotFound,
  apiError,
  apiRateLimited,
} from "@/lib/api/response";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { checkRateLimit, EMAIL_SEND_LIMIT } from "@/lib/api/rate-limit";
import { scopedClient, type ScopedClient } from "@/lib/supabase/scoped";
import { validate, required, maxLength, isUUID } from "@/lib/api/validation";
import { emitEvent } from "@/lib/api/audit";
import { logger } from "@/lib/logger";
import { sendMessage } from "@/industries/_shared/features/email/lib/gmail-client";
import { decryptAccountTokens, persistRefreshedToken } from "@/industries/_shared/features/email/lib/token-crypto";
import { mintToken, getInboundDomains } from "@/lib/email/inbound/tokens";
import { resolveReplyToLabel } from "@/lib/email/reply-to-label";
import type { ConnectedEmailAccount } from "@/types/database";

function isStringArray(val: unknown): val is string[] {
  return Array.isArray(val) && val.every((v) => typeof v === "string");
}

/**
 * Drops our own inbound-domain addresses (reply/bcc dropbox tokens) from the
 * bcc list before it's persisted to emails.bcc_emails — any teammate who can
 * see the thread can read that column, and a dropbox address is a per-user
 * addressing secret. The full list still gets SENT; only persistence is
 * filtered. getInboundDomains() throws when INBOUND_EMAIL_DOMAINS is unset —
 * that must not break a send, so fall back to persisting the list unfiltered.
 */
function filterOwnDomainsForPersistence(bcc: string[]): string[] {
  let domains: string[];
  try {
    domains = getInboundDomains();
  } catch {
    return bcc;
  }
  return bcc.filter((addr) => {
    const domain = addr.split("@")[1]?.toLowerCase();
    return !domain || !domains.includes(domain);
  });
}

/**
 * Best-effort rollback of whatever the inbound-spine pre-send wiring managed
 * to create before a failure (either wiring itself failing, or the Gmail
 * send failing). `email_threads.id -> inbound_addresses.thread_id` is
 * ON DELETE CASCADE (migration 191), so deleting a provisional thread also
 * removes its just-minted token; the explicit address delete only matters
 * when the thread pre-existed (reply case) and just the token needs undoing.
 * Never throws — a cleanup failure must not mask the original error.
 */
async function cleanupProvisionalInboundArtifacts(
  db: ScopedClient,
  ids: { mintedAddressId: string | null; provisionalThreadId: string | null },
): Promise<void> {
  try {
    if (ids.mintedAddressId) {
      await db.from("inbound_addresses").delete().eq("id", ids.mintedAddressId);
    }
    if (ids.provisionalThreadId) {
      await db.from("email_threads").delete().eq("id", ids.provisionalThreadId);
    }
  } catch (cleanupErr) {
    logger.warn({ cleanupErr }, "Failed to clean up provisional inbound-spine artifacts (non-fatal)");
  }
}

export async function POST(request: Request) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.EMAIL)) return apiForbidden();

  const rate = await checkRateLimit(`email_send:${auth.userId}`, EMAIL_SEND_LIMIT);
  if (!rate.allowed) return apiRateLimited(rate.retryAfterSeconds);

  const body = await request.json();

  const validation = validate(body, {
    from_account_id: [required("from_account_id"), isUUID()],
    subject: [required("subject"), maxLength(500)],
    body_html: [required("body_html"), maxLength(200000)],
  });
  if (!validation.valid) return apiValidationError(validation.errors);

  if (!isStringArray(body.to) || body.to.length === 0) {
    return apiValidationError({ to: ["to must be a non-empty array of email addresses"] });
  }

  const db = await scopedClient(auth);

  // Verify user owns the from_account — 403 rather than 404 to never leak existence of another user's account
  const { data: rawAccount, error: acctErr } = await db
    .from("connected_email_accounts")
    .select("*")
    .eq("id", body.from_account_id)
    .eq("user_id", auth.userId)
    .single<ConnectedEmailAccount>();
  if (acctErr || !rawAccount) return apiForbidden();

  let account: ConnectedEmailAccount;
  try {
    account = decryptAccountTokens(rawAccount);
  } catch (err) {
    logger.error({ err, from_account_id: rawAccount.id }, "Failed to decrypt stored Gmail token");
    return apiServiceUnavailable(
      "Failed to send via Gmail. Check inbox connection in Settings.",
    );
  }

  // Phase 3: validate reply_context if provided
  let thread: {
    id: string;
    message_count: number;
    connected_email_account_id: string;
    lead_id: string | null;
    contact_id: string | null;
    gmail_thread_id: string;
  } | null = null;

  if (body.reply_context && typeof body.reply_context === "object") {
    const { thread_id, in_reply_to, references } = body.reply_context;
    if (!thread_id || typeof thread_id !== "string") {
      return apiValidationError({ reply_context: ["reply_context.thread_id is required"] });
    }

    const { data: t, error: threadErr } = await db
      .from("email_threads")
      .select("id, message_count, connected_email_account_id, lead_id, contact_id, gmail_thread_id")
      .eq("id", thread_id)
      .single<{
        id: string;
        message_count: number;
        connected_email_account_id: string;
        lead_id: string | null;
        contact_id: string | null;
        gmail_thread_id: string;
      }>();

    if (threadErr || !t) return apiNotFound("Email thread");

    // Same-account constraint: can't reply on a thread belonging to a different inbox
    if (t.connected_email_account_id !== body.from_account_id) {
      return apiError(
        "REPLY_ACCOUNT_MISMATCH",
        "Reply must be sent from the thread's original account.",
        400,
      );
    }

    thread = {
      ...t,
      // Preserve validated reply fields on the local variable
    };

    // Attach validated fields to body for use below
    body.reply_context = {
      thread_id,
      in_reply_to: typeof in_reply_to === "string" ? in_reply_to : null,
      references: isStringArray(references) ? references : [],
    };
  }

  // Server-side merge-field interpolation before send + store
  let subject = body.subject as string;
  let bodyHtml = body.body_html as string;

  const effectiveLeadId = body.lead_id ?? thread?.lead_id ?? null;
  const effectiveContactId = body.contact_id ?? thread?.contact_id ?? null;

  if (effectiveLeadId && typeof effectiveLeadId === "string") {
    // Counselor scoping: use membership-aware visibility (covers per-branch assignees)
    let allowInterpolation = true;
    if (shouldRestrictToSelf(auth.permissions)) {
      // Per-lead check avoids enumerating all assigned IDs into memory (URL overflow risk).
      allowInterpolation = await shouldLeadBeVisibleToAssignee(db.raw(), auth.tenantId, effectiveLeadId, auth.userId);
    }

    if (allowInterpolation) {
      const { data: lead } = await db
        .from("leads")
        .select("first_name, last_name")
        .eq("id", effectiveLeadId)
        .single<{ first_name?: string; last_name?: string }>();

      if (lead) {
        const replace = (s: string) =>
          s
            .replace(/\{\{\s*first_name\s*\}\}/g, lead.first_name ?? "")
            .replace(/\{\{\s*last_name\s*\}\}/g, lead.last_name ?? "");
        subject = replace(subject);
        bodyHtml = replace(bodyHtml);
      }
    }
  }

  // Build the references chain for reply: [...lastMessage.rfc_references, lastMessage.rfc_message_id]
  const replyInReplyTo = body.reply_context?.in_reply_to ?? undefined;
  const replyReferences: string[] = body.reply_context?.references ?? [];

  // Inbound spine (brief §3 finding 3, §6): resolve/create the thread and
  // mint a reply-to token BEFORE sending, so the Reply-To header can point
  // back at it — this is the ordering inversion the brief calls the riskiest
  // change in the phase. Gated on EDGEX_INBOUND_ENABLED && the tenant's
  // inbound_enabled; when off (or if wiring it up errors for any reason)
  // replyTo stays undefined and everything below behaves exactly as before
  // this feature existed. Outbound send must never regress because inbound
  // infra is misconfigured, so wiring failures are logged and swallowed
  // here rather than failing the whole request.
  let replyTo: string | undefined;
  let provisionalThreadId: string | null = null; // only set if THIS request created it
  let mintedAddressId: string | null = null;

  if (process.env.EDGEX_INBOUND_ENABLED === "true") {
    try {
      const { data: settings } = await db
        .from("tenant_email_settings")
        .select("inbound_enabled")
        .maybeSingle<{ inbound_enabled: boolean }>();

      if (settings?.inbound_enabled) {
        let targetThreadId = thread?.id ?? null;

        if (!targetThreadId) {
          const { data: newThread, error: threadErr } = await db
            .from("email_threads")
            .insert({
              connected_email_account_id: account.id,
              gmail_thread_id: null,
              lead_id: effectiveLeadId,
              contact_id: effectiveContactId,
              subject,
              last_message_at: new Date().toISOString(),
              message_count: 0,
            })
            .select("id")
            .single<{ id: string }>();
          if (threadErr || !newThread) {
            throw new Error(`provisional email_threads insert failed: ${threadErr?.message}`);
          }
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
        if (addrErr || !addrRow) {
          throw new Error(`inbound_addresses insert failed: ${addrErr?.message}`);
        }

        mintedAddressId = addrRow.id;

        const label = await resolveReplyToLabel(db, {
          accountDisplayName: account.display_name,
          userId: auth.userId,
          tenantId: auth.tenantId,
        });
        replyTo = label ? `"${label}" <${minted.address}>` : minted.address;
      }
    } catch (err) {
      logger.error(
        { err, from_account_id: account.id },
        "Inbound-spine pre-send wiring failed — sending without Reply-To",
      );
      await cleanupProvisionalInboundArtifacts(db, { mintedAddressId, provisionalThreadId });
      replyTo = undefined;
      mintedAddressId = null;
      provisionalThreadId = null;
    }
  }

  // Send via Gmail
  let result: Awaited<ReturnType<typeof sendMessage>>;
  try {
    result = await sendMessage(account, {
      from: account.email,
      fromName: account.display_name ?? undefined,
      to: body.to as string[],
      cc: isStringArray(body.cc) ? body.cc : [],
      bcc: isStringArray(body.bcc) ? body.bcc : [],
      subject,
      bodyHtml,
      threadId: thread?.gmail_thread_id,
      inReplyTo: replyInReplyTo,
      references: replyReferences.length > 0 ? replyReferences : undefined,
      replyTo,
    });
  } catch (err) {
    logger.error({ err, from_account_id: account.id }, "Gmail send failed");
    // Nothing was durably delivered — undo whatever pre-send wiring created
    // (provisional thread and/or its reply-to token) so a failed send never
    // leaves a phantom thread or a live token for a message that never went out.
    await cleanupProvisionalInboundArtifacts(db, { mintedAddressId, provisionalThreadId });
    return apiServiceUnavailable(
      "Failed to send via Gmail. Check inbox connection in Settings.",
    );
  }

  // Persist refreshed token if obtained (fire-and-forget — email already sent).
  // persistRefreshedToken() never throws, so an encrypt/DB failure here is
  // logged and swallowed rather than surfacing as a 500 after Gmail already
  // delivered the message.
  if (result.refreshed_credentials) {
    void persistRefreshedToken(db.raw(), account.id, result.refreshed_credentials);
  }

  // Persist thread: reuse for reply, patch the provisional thread created
  // above (inbound spine, gate ON), or create new for fresh compose (gate OFF
  // — original post-send ordering, unchanged).
  let threadId: string;
  if (thread) {
    threadId = thread.id;
    await db
      .from("email_threads")
      .update({
        message_count: thread.message_count + 1,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", thread.id);
  } else if (provisionalThreadId) {
    threadId = provisionalThreadId;
    await db
      .from("email_threads")
      .update({
        gmail_thread_id: result.gmail_thread_id,
        message_count: 1,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", provisionalThreadId);
  } else {
    const { data: newThread, error: threadErr } = await db
      .from("email_threads")
      .insert({
        connected_email_account_id: account.id,
        gmail_thread_id: result.gmail_thread_id,
        lead_id: effectiveLeadId,
        contact_id: effectiveContactId,
        subject,
        last_message_at: new Date().toISOString(),
        message_count: 1,
      })
      .select("id")
      .single<{ id: string }>();
    if (threadErr || !newThread) {
      logger.error({ threadErr, gmail_message_id: result.gmail_message_id }, "email_threads insert failed after successful Gmail send");
      return apiInternalError();
    }
    threadId = newThread.id;
  }

  // Persist outbound email row
  const { data: email, error: emailErr } = await db
    .from("emails")
    .insert({
      thread_id: threadId,
      connected_email_account_id: account.id,
      direction: "outbound",
      from_email: account.email,
      from_name: account.display_name,
      to_emails: body.to,
      cc_emails: isStringArray(body.cc) ? body.cc : [],
      bcc_emails: filterOwnDomainsForPersistence(isStringArray(body.bcc) ? body.bcc : []),
      subject,
      body_html: bodyHtml,
      body_text: null,
      gmail_message_id: result.gmail_message_id,
      rfc_message_id: result.rfc_message_id,
      in_reply_to: replyInReplyTo ?? null,
      rfc_references: replyReferences,
      sent_at: new Date().toISOString(),
      sender_user_id: auth.userId,
    })
    .select("id")
    .single<{ id: string }>();
  if (emailErr || !email) {
    logger.error({ emailErr, thread_id: threadId }, "emails insert failed after successful Gmail send");
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
      from_account_id: account.id,
      sender_user_id: auth.userId,
      to_emails: body.to,
    },
  });

  return apiSuccess({
    thread_id: threadId,
    email_id: email.id,
    gmail_message_id: result.gmail_message_id,
  });
}

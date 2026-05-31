import { authenticateRequest } from "@/lib/api/auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiSuccess,
  apiInternalError,
  apiValidationError,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { scopedClient } from "@/lib/supabase/scoped";
import { validate, required, maxLength, isUUID } from "@/lib/api/validation";
import { emitEvent } from "@/lib/api/audit";
import { logger } from "@/lib/logger";
import { sendMessage } from "@/industries/education-consultancy/features/email/lib/gmail-client";
import type { ConnectedEmailAccount } from "@/types/database";

function isStringArray(val: unknown): val is string[] {
  return Array.isArray(val) && val.every((v) => typeof v === "string");
}

export async function POST(request: Request) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.EMAIL)) return apiForbidden();

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
  const { data: account, error: acctErr } = await db
    .from("connected_email_accounts")
    .select("*")
    .eq("id", body.from_account_id)
    .eq("user_id", auth.userId)
    .single<ConnectedEmailAccount>();
  if (acctErr || !account) return apiForbidden();

  // Server-side merge-field interpolation before send + store
  let subject = body.subject as string;
  let bodyHtml = body.body_html as string;

  if (body.lead_id && typeof body.lead_id === "string") {
    let leadQuery = db
      .from("leads")
      .select("first_name, last_name")
      .eq("id", body.lead_id);

    // Counselor scoping: only interpolate from leads assigned to this user (Fix 4)
    if (auth.role === "counselor") {
      leadQuery = leadQuery.eq("assigned_to", auth.userId);
    }

    const { data: lead } = await leadQuery.single<{ first_name?: string; last_name?: string }>();

    if (lead) {
      const replace = (s: string) =>
        s
          .replace(/\{\{\s*first_name\s*\}\}/g, lead.first_name ?? "")
          .replace(/\{\{\s*last_name\s*\}\}/g, lead.last_name ?? "");
      subject = replace(subject);
      bodyHtml = replace(bodyHtml);
    }
  }

  // Send via Gmail (Fix 3: sendMessage now calls refreshAccessTokenIfNeeded internally)
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
    });
  } catch (err) {
    logger.error({ err, from_account_id: account.id }, "Gmail send failed");
    return apiServiceUnavailable(
      "Failed to send via Gmail. Check inbox connection in Settings.",
    );
  }

  // Persist refreshed token if obtained (fire-and-forget — email already sent)
  if (result.refreshed_credentials) {
    const { access_token, expiry_date } = result.refreshed_credentials;
    db.from("connected_email_accounts")
      .update({
        access_token,
        token_expiry: new Date(expiry_date).toISOString(),
      })
      .eq("id", account.id)
      .then(({ error }) => {
        if (error) logger.error({ error, account_id: account.id }, "Failed to persist refreshed token");
      });
  }

  // Persist thread (Phase 2 always creates a new thread)
  const { data: thread, error: threadErr } = await db
    .from("email_threads")
    .insert({
      connected_email_account_id: account.id,
      gmail_thread_id: result.gmail_thread_id,
      lead_id: body.lead_id ?? null,
      contact_id: body.contact_id ?? null,
      subject,
      last_message_at: new Date().toISOString(),
      message_count: 1,
    })
    .select("id")
    .single<{ id: string }>();
  if (threadErr || !thread) {
    logger.error({ threadErr, gmail_message_id: result.gmail_message_id }, "email_threads insert failed after successful Gmail send");
    return apiInternalError();
  }

  // Persist outbound email row
  const { data: email, error: emailErr } = await db
    .from("emails")
    .insert({
      thread_id: thread.id,
      connected_email_account_id: account.id,
      direction: "outbound",
      from_email: account.email,
      from_name: account.display_name,
      to_emails: body.to,
      cc_emails: isStringArray(body.cc) ? body.cc : [],
      bcc_emails: isStringArray(body.bcc) ? body.bcc : [],
      subject,
      body_html: bodyHtml,
      body_text: null,
      gmail_message_id: result.gmail_message_id,
      rfc_message_id: result.rfc_message_id,
      in_reply_to: null,
      rfc_references: [],
      sent_at: new Date().toISOString(),
      sender_user_id: auth.userId,
    })
    .select("id")
    .single<{ id: string }>();
  if (emailErr || !email) {
    logger.error({ emailErr, thread_id: thread.id }, "emails insert failed after successful Gmail send");
    return apiInternalError();
  }

  await emitEvent({
    tenantId: auth.tenantId,
    type: "email.sent",
    entityType: "email",
    entityId: email.id,
    payload: {
      thread_id: thread.id,
      lead_id: body.lead_id ?? null,
      contact_id: body.contact_id ?? null,
      subject,
      from_account_id: account.id,
      sender_user_id: auth.userId,
      to_emails: body.to,
    },
  });

  return apiSuccess({
    thread_id: thread.id,
    email_id: email.id,
    gmail_message_id: result.gmail_message_id,
  });
}

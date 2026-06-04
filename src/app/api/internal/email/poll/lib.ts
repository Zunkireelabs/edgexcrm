import { google } from "googleapis";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { emitEvent } from "@/lib/api/audit";
import { upsertThreadNotification, NotificationTypes } from "@/lib/notifications";
import { listHistory, getMessage, createOAuth2Client, refreshAccessTokenIfNeeded } from "@/industries/education-consultancy/features/email/lib/gmail-client";
import type { ParsedMessage } from "@/industries/education-consultancy/features/email/lib/gmail-client";
import type { ConnectedEmailAccount } from "@/types/database";

interface EmailThread {
  id: string;
  message_count: number;
  tenant_id: string;
  lead_id: string | null;
  contact_id: string | null;
  gmail_thread_id: string;
  connected_email_account_id: string;
}

export async function persistRefreshedToken(
  supabase: SupabaseClient,
  accountId: string,
  refreshed: { access_token: string; expiry_date: number },
): Promise<void> {
  const { error } = await supabase
    .from("connected_email_accounts")
    .update({
      access_token: refreshed.access_token,
      token_expiry: new Date(refreshed.expiry_date).toISOString(),
    })
    .eq("id", accountId);
  if (error) {
    logger.warn({ error, accountId }, "Failed to persist refreshed token (non-fatal)");
  }
}

async function matchInboundToThread(
  supabase: SupabaseClient,
  account: ConnectedEmailAccount,
  parsed: ParsedMessage,
): Promise<EmailThread | null> {
  // Primary: match by Gmail threadId (exact for Gmail-to-Gmail)
  const { data: byThreadId } = await supabase
    .from("email_threads")
    .select("id, message_count, tenant_id, lead_id, contact_id, gmail_thread_id, connected_email_account_id")
    .eq("connected_email_account_id", account.id)
    .eq("gmail_thread_id", parsed.gmail_thread_id)
    .maybeSingle();
  if (byThreadId) return byThreadId as EmailThread;

  // Fallback 1: RFC In-Reply-To header (vendor-independent)
  if (parsed.in_reply_to) {
    const { data: parentEmail } = await supabase
      .from("emails")
      .select("thread_id")
      .eq("rfc_message_id", parsed.in_reply_to)
      .eq("connected_email_account_id", account.id)
      .maybeSingle();
    if (parentEmail) {
      const { data: thread } = await supabase
        .from("email_threads")
        .select("id, message_count, tenant_id, lead_id, contact_id, gmail_thread_id, connected_email_account_id")
        .eq("id", parentEmail.thread_id)
        .maybeSingle();
      if (thread) return thread as EmailThread;
    }
  }

  // Fallback 2: References chain (most recent first — last item is most specific)
  for (const refId of [...parsed.references].reverse()) {
    const { data: parentEmail } = await supabase
      .from("emails")
      .select("thread_id")
      .eq("rfc_message_id", refId)
      .eq("connected_email_account_id", account.id)
      .maybeSingle();
    if (parentEmail) {
      const { data: thread } = await supabase
        .from("email_threads")
        .select("id, message_count, tenant_id, lead_id, contact_id, gmail_thread_id, connected_email_account_id")
        .eq("id", parentEmail.thread_id)
        .maybeSingle();
      if (thread) return thread as EmailThread;
    }
  }

  return null;
}

export async function pollOneAccount(
  supabase: SupabaseClient,
  account: ConnectedEmailAccount,
): Promise<{ newInboundCount: number }> {
  // Load sync state (create baseline if first poll)
  const { data: existingState } = await supabase
    .from("email_sync_state")
    .select("*")
    .eq("connected_email_account_id", account.id)
    .maybeSingle();

  let lastHistoryId: string | null = existingState?.last_history_id ?? null;

  // First-time poll: bootstrap baseline from current profile.historyId
  if (!lastHistoryId) {
    const refreshed = await refreshAccessTokenIfNeeded(account);
    const client = createOAuth2Client(account.refresh_token);
    if (refreshed) {
      client.setCredentials({
        refresh_token: account.refresh_token,
        access_token: refreshed.access_token,
        expiry_date: refreshed.expiry_date,
      });
    }
    const profile = await google.gmail({ version: "v1", auth: client }).users.getProfile({ userId: "me" });
    lastHistoryId = String(profile.data.historyId);
    await supabase.from("email_sync_state").upsert(
      {
        connected_email_account_id: account.id,
        last_history_id: lastHistoryId,
        last_synced_at: new Date().toISOString(),
        consecutive_error_count: 0,
        last_error: null,
      },
      { onConflict: "connected_email_account_id" },
    );
    if (refreshed) {
      await persistRefreshedToken(supabase, account.id, refreshed);
    }
    return { newInboundCount: 0 };
  }

  try {
    const { historyId, messageAddedIds, refreshed_credentials, expired } = await listHistory(
      account,
      lastHistoryId,
    );

    if (refreshed_credentials) {
      await persistRefreshedToken(supabase, account.id, refreshed_credentials);
    }

    // History gap: bootstrap from current profile historyId, skip the gap
    if (expired) {
      const client = createOAuth2Client(account.refresh_token);
      const profile = await google.gmail({ version: "v1", auth: client }).users.getProfile({ userId: "me" });
      await supabase
        .from("email_sync_state")
        .update({
          last_history_id: String(profile.data.historyId),
          last_synced_at: new Date().toISOString(),
          consecutive_error_count: 0,
          last_error: "history_expired_bootstrapped",
        })
        .eq("connected_email_account_id", account.id);
      return { newInboundCount: 0 };
    }

    if (messageAddedIds.length === 0) {
      await supabase
        .from("email_sync_state")
        .update({
          last_history_id: historyId,
          last_synced_at: new Date().toISOString(),
          consecutive_error_count: 0,
          last_error: null,
        })
        .eq("connected_email_account_id", account.id);
      return { newInboundCount: 0 };
    }

    let newInboundCount = 0;
    // Per-cycle dedup: avoid multiple notifications for the same thread in one poll run
    const notifiedThreadIds = new Set<string>();

    for (const messageId of messageAddedIds) {
      try {
        const { message: parsed, refreshed_credentials: r2 } = await getMessage(account, messageId);
        if (r2) await persistRefreshedToken(supabase, account.id, r2);

        // Skip messages we sent — Gmail's history surfaces our outbound as messageAdded too
        if (parsed.from_email.toLowerCase() === account.email.toLowerCase()) continue;

        const thread = await matchInboundToThread(supabase, account, parsed);
        if (!thread) continue; // orphan — silently drop

        // Persist inbound email row
        const { data: emailRow, error: insertErr } = await supabase
          .from("emails")
          .insert({
            tenant_id: account.tenant_id,
            thread_id: thread.id,
            connected_email_account_id: account.id,
            direction: "inbound",
            from_email: parsed.from_email,
            from_name: parsed.from_name,
            to_emails: parsed.to_emails,
            cc_emails: parsed.cc_emails,
            bcc_emails: [],
            subject: parsed.subject,
            body_html: parsed.body_html,
            body_text: parsed.body_text,
            gmail_message_id: parsed.gmail_message_id,
            rfc_message_id: parsed.rfc_message_id,
            in_reply_to: parsed.in_reply_to,
            rfc_references: parsed.references,
            received_at: parsed.received_at,
            sent_at: null,
            sender_user_id: null,
          })
          .select("id")
          .single();

        if (insertErr || !emailRow) {
          logger.error({ insertErr, messageId, account_id: account.id }, "Failed to insert inbound email row");
          continue;
        }

        // Update thread metadata
        await supabase
          .from("email_threads")
          .update({
            message_count: thread.message_count + 1,
            last_message_at: parsed.received_at,
            updated_at: new Date().toISOString(),
          })
          .eq("id", thread.id);

        // Emit email.received event
        await emitEvent({
          tenantId: account.tenant_id,
          type: "email.received",
          entityType: "email",
          entityId: emailRow.id,
          payload: {
            thread_id: thread.id,
            lead_id: thread.lead_id,
            contact_id: thread.contact_id,
            from_email: parsed.from_email,
            subject: parsed.subject,
            received_at: parsed.received_at,
            from_account_id: account.id,
          },
        });

        // Notify inbox owner and lead assignee (per-cycle dedup by thread)
        if (!notifiedThreadIds.has(thread.id)) {
          notifiedThreadIds.add(thread.id);
          try {
            const recipientIds = new Set<string>();
            recipientIds.add(account.user_id);

            if (thread.lead_id) {
              const { data: leadRow } = await supabase
                .from("leads")
                .select("assigned_to")
                .eq("id", thread.lead_id)
                .maybeSingle();
              if (leadRow?.assigned_to) recipientIds.add(leadRow.assigned_to);
            }

            const senderLabel = parsed.from_name || parsed.from_email;
            const subjectLabel = parsed.subject || "(no subject)";
            const link = thread.lead_id ? `/leads/${thread.lead_id}` : undefined;

            await Promise.all(
              Array.from(recipientIds).map((userId) =>
                upsertThreadNotification({
                  tenantId: account.tenant_id,
                  userId,
                  type: NotificationTypes.EMAIL_RECEIVED,
                  title: "New email reply",
                  message: `${senderLabel}: ${subjectLabel}`,
                  link,
                })
              )
            );
          } catch (notifyErr) {
            logger.warn({ err: notifyErr, thread_id: thread.id }, "Failed to create email.received notification (non-fatal)");
          }
        }

        newInboundCount += 1;
      } catch (msgErr) {
        logger.error({ err: msgErr, messageId, account_id: account.id }, "Failed to process inbound message");
        // Don't fail the whole poll — skip this message, continue
      }
    }

    await supabase
      .from("email_sync_state")
      .update({
        last_history_id: historyId,
        last_synced_at: new Date().toISOString(),
        consecutive_error_count: 0,
        last_error: null,
      })
      .eq("connected_email_account_id", account.id);

    return { newInboundCount };
  } catch (err) {
    logger.error({ err, account_id: account.id }, "Poll failed for account");
    await supabase
      .from("email_sync_state")
      .update({
        last_synced_at: new Date().toISOString(),
        last_error: String(err).substring(0, 500),
        consecutive_error_count: (existingState?.consecutive_error_count ?? 0) + 1,
      })
      .eq("connected_email_account_id", account.id);
    throw err; // propagate to allSettled — counted as error in caller
  }
}

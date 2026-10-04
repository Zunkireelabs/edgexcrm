// Unified sendMessage service.
// BOTH the human composer route AND a future AI tool call go through here —
// identical except for the author field. Full AI autonomy later = auto-approve
// policy over this one path, not new plumbing.

import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { getAdapter } from "./adapters";
import { decryptToken } from "./crypto";
import type { InboxProvider } from "./adapters/types";

export interface HumanAuthor {
  type: "human_agent";
  userId: string;
}

export interface AiAuthor {
  type: "ai_agent";
  aiMetadata: Record<string, unknown>;
}

export interface SystemAuthor {
  type: "system";
}

export interface SendMessageInput {
  tenantId: string;
  conversationId: string;
  content: string;
  author: HumanAuthor | AiAuthor | SystemAuthor;
  /** If provided, flip an existing draft row to sent instead of inserting a new row */
  fromDraftMessageId?: string;
}

export interface SendMessageResult {
  messageId: string;
  providerMessageId: string | null;
  status: string;
  error?: string;
}

interface ConversationRow {
  id: string;
  tenant_id: string;
  channel_id: string;
  provider: string;
  external_contact_id: string;
  contact_phone: string | null;
  contact_display_name: string | null;
  lead_id: string | null;
  ai_autonomy: string;
}

interface ChannelRow {
  id: string;
  tenant_id: string;
  provider: string;
  external_account_id: string;
  display_name: string;
  status: string;
  access_token: string | null;
  webhook_verify_token_hash: string | null;
  meta: Record<string, unknown>;
}

export async function sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
  const supabase = await createServiceClient();

  // Load conversation + channel
  const { data: conv, error: convErr } = await supabase
    .from("conversations")
    .select("id, tenant_id, channel_id, provider, external_contact_id, contact_phone, contact_display_name, lead_id, ai_autonomy")
    .eq("id", input.conversationId)
    .eq("tenant_id", input.tenantId)
    .single();

  if (convErr || !conv) {
    throw new Error(`Conversation not found: ${input.conversationId}`);
  }
  const conversation = conv as ConversationRow;

  const { data: ch, error: chErr } = await supabase
    .from("inbox_channels")
    .select("id, tenant_id, provider, external_account_id, display_name, status, access_token, webhook_verify_token_hash, meta")
    .eq("id", conversation.channel_id)
    .single();

  if (chErr || !ch) {
    throw new Error(`Channel not found: ${conversation.channel_id}`);
  }
  const channel = ch as ChannelRow;

  const adapter = getAdapter(conversation.provider as InboxProvider);

  // Session-window guard: enforce for providers that require templates outside the window.
  // Template composing UI is out of scope — if we're outside the window and no template is
  // provided, fail early so the rep gets a clear error instead of a silent Meta rejection.
  if (adapter.capabilities.requiresTemplateOutsideWindow && adapter.capabilities.sessionWindowHours !== null) {
    const windowHours = adapter.capabilities.sessionWindowHours;

    const { data: latestInbound } = await supabase
      .from("messages")
      .select("provider_timestamp, created_at")
      .eq("conversation_id", input.conversationId)
      .eq("tenant_id", input.tenantId)
      .eq("direction", "inbound")
      .order("provider_timestamp", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    const lastInboundTs = latestInbound
      ? ((latestInbound as { provider_timestamp: string | null; created_at: string }).provider_timestamp ??
          (latestInbound as { provider_timestamp: string | null; created_at: string }).created_at)
      : null;

    const outsideWindow =
      !lastInboundTs ||
      Date.now() - new Date(lastInboundTs).getTime() > windowHours * 3600 * 1000;

    if (outsideWindow) {
      const errMsg = `OUTSIDE_SESSION_WINDOW: no inbound message in the last ${windowHours}h — a pre-approved template is required to initiate this conversation`;
      logger.warn(
        { conversationId: input.conversationId, provider: conversation.provider, lastInboundTs },
        errMsg
      );
      return { messageId: "", providerMessageId: null, status: "failed", error: errMsg };
    }
  }

  const authorUserId = input.author.type === "human_agent" ? input.author.userId : null;
  const aiMetadata = input.author.type === "ai_agent" ? input.author.aiMetadata : null;

  let messageId: string;

  if (input.fromDraftMessageId) {
    // Flip existing draft row: draft → queued
    const { data: updated, error: updateErr } = await supabase
      .from("messages")
      .update({ status: "queued", author_user_id: authorUserId })
      .eq("id", input.fromDraftMessageId)
      .eq("tenant_id", input.tenantId)
      .eq("status", "draft")
      .select("id")
      .single();

    if (updateErr || !updated) {
      throw new Error(`Draft message not found or already sent: ${input.fromDraftMessageId}`);
    }
    messageId = (updated as { id: string }).id;
  } else {
    // Insert new outbound row
    const { data: inserted, error: insertErr } = await supabase
      .from("messages")
      .insert({
        tenant_id: input.tenantId,
        conversation_id: input.conversationId,
        channel_id: conversation.channel_id,
        direction: "outbound",
        author_type: input.author.type,
        author_user_id: authorUserId,
        content_text: input.content,
        status: "queued",
        ai_metadata: aiMetadata ?? null,
      })
      .select("id")
      .single();

    if (insertErr || !inserted) {
      throw new Error(`Failed to insert message: ${insertErr?.message}`);
    }
    messageId = (inserted as { id: string }).id;
  }

  // Decrypt the channel access token (encrypted at rest since Phase 3a).
  // Fail closed: if the key is missing or the blob is invalid, fail the send rather
  // than sending a garbled token to the provider. Sandbox has no access_token → skipped.
  let plaintextToken: string | null = channel.access_token;
  if (channel.access_token) {
    try {
      plaintextToken = decryptToken(channel.access_token);
    } catch (decryptErr) {
      const errMsg = `Failed to decrypt channel access token: ${decryptErr instanceof Error ? decryptErr.message : String(decryptErr)}`;
      logger.error({ err: decryptErr, channelId: channel.id }, errMsg);
      await supabase
        .from("messages")
        .update({ status: "failed", error: errMsg })
        .eq("id", messageId)
        .eq("tenant_id", input.tenantId);
      return { messageId, providerMessageId: null, status: "failed", error: errMsg };
    }
  }

  // Attempt delivery
  let providerMessageId: string | null = null;
  let finalStatus = "sent";

  try {
    const result = await adapter.sendMessage(
      {
        id: channel.id,
        tenant_id: channel.tenant_id,
        provider: channel.provider as InboxProvider,
        external_account_id: channel.external_account_id,
        display_name: channel.display_name,
        status: channel.status,
        access_token: plaintextToken,
        webhook_verify_token_hash: channel.webhook_verify_token_hash,
        meta: channel.meta,
      },
      {
        id: conversation.id,
        tenant_id: conversation.tenant_id,
        channel_id: conversation.channel_id,
        provider: conversation.provider as InboxProvider,
        external_contact_id: conversation.external_contact_id,
        contact_phone: conversation.contact_phone,
        contact_display_name: conversation.contact_display_name,
        lead_id: conversation.lead_id,
      },
      { text: input.content }
    );
    providerMessageId = result.providerMessageId;
  } catch (err) {
    finalStatus = "failed";
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err, conversationId: input.conversationId }, "sendMessage: provider delivery failed");
    await supabase
      .from("messages")
      .update({ status: "failed", error: errMsg })
      .eq("id", messageId)
      .eq("tenant_id", input.tenantId);
    return { messageId, providerMessageId: null, status: "failed" };
  }

  // Update message to sent + store provider_message_id
  await supabase
    .from("messages")
    .update({
      status: finalStatus,
      provider_message_id: providerMessageId,
    })
    .eq("id", messageId)
    .eq("tenant_id", input.tenantId);

  // Bump conversation last_message_*
  await supabase
    .from("conversations")
    .update({
      last_message_at: new Date().toISOString(),
      last_message_preview: input.content.slice(0, 200),
      last_message_direction: "outbound",
    })
    .eq("id", input.conversationId)
    .eq("tenant_id", input.tenantId);

  return { messageId, providerMessageId, status: finalStatus };
}

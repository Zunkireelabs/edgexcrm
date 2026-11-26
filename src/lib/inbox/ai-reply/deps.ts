// The real database / sending side of an AI reply. Every query is scoped to the tenant.

import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { NotificationTypes, upsertThreadNotification } from "@/lib/notifications";
import { resolveInboundRecipients } from "@/lib/inbox/inbound-recipients";
import { OWNERLESS_FILTER } from "@/lib/inbox/claim-rules";
import { sendMessage } from "@/lib/inbox/send-message";
import { aiReplyEnv } from "./config";
import { askSearch } from "./search-client";
import type { AiReplyDeps, ChatState } from "./run";

const RECENT_MESSAGES = 30;

export function realAiReplyDeps(): AiReplyDeps {
  return {
    env: aiReplyEnv(),

    async loadState(tenantId, conversationId): Promise<ChatState | null> {
      const db = await createServiceClient();
      const { data: conv } = await db
        .from("conversations")
        .select("channel_id, provider, status, ai_autonomy, assignee_type, assigned_to_user_id")
        .eq("id", conversationId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (!conv) return null;
      const c = conv as ChatState["conversation"] & { channel_id: string };

      const [{ data: channel }, { data: tenant }, { data: recent }] = await Promise.all([
        db.from("inbox_channels").select("meta").eq("id", c.channel_id).eq("tenant_id", tenantId).maybeSingle(),
        db.from("tenants").select("ai_enabled, industry_id").eq("id", tenantId).maybeSingle(),
        db
          .from("messages")
          .select("id, author_type, content_text")
          .eq("conversation_id", conversationId)
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
          .limit(RECENT_MESSAGES),
      ]);
      if (!tenant) return null;

      const newestFirst = (recent ?? []) as { id: string; author_type: string; content_text: string | null }[];
      // The newest message that is not a system note decides "who spoke last".
      const lastReal = newestFirst.find((m) => m.author_type !== "system");
      return {
        channelMeta: (channel as { meta?: unknown } | null)?.meta ?? null,
        tenant: tenant as ChatState["tenant"],
        conversation: { provider: c.provider, status: c.status, ai_autonomy: c.ai_autonomy, assignee_type: c.assignee_type, assigned_to_user_id: c.assigned_to_user_id },
        lastAuthorType: lastReal?.author_type ?? null,
        lastMessageId: lastReal?.id ?? null,
        lines: [...newestFirst].reverse(),
      };
    },

    async latestMessageId(tenantId, conversationId) {
      const db = await createServiceClient();
      const { data } = await db
        .from("messages")
        .select("id, author_type")
        .eq("conversation_id", conversationId)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(5);
      const newest = ((data ?? []) as { id: string; author_type: string }[]).find((m) => m.author_type !== "system");
      return newest?.id ?? null;
    },

    async stillUnowned(tenantId, conversationId) {
      const db = await createServiceClient();
      const { data } = await db
        .from("conversations")
        .select("id")
        .eq("id", conversationId)
        .eq("tenant_id", tenantId)
        .or(OWNERLESS_FILTER)
        .maybeSingle();
      return !!data;
    },

    ask: askSearch,

    async sendAi({ tenantId, conversationId, text, kind, reason, siteId }) {
      const result = await sendMessage({
        tenantId,
        conversationId,
        content: text,
        author: { type: "ai_agent", aiMetadata: { source: "zunkiree-search", kind, reason, site_id: siteId, session_id: conversationId } },
      });
      return { status: result.status };
    },

    async markHandoff({ tenantId, conversationId, reason }) {
      const db = await createServiceClient();
      const { data: conv } = await db
        .from("conversations")
        .select("meta, provider, assignee_type, assigned_to_user_id, lead_id, contact_display_name, contact_phone")
        .eq("id", conversationId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (!conv) return;
      const c = conv as { meta: Record<string, unknown> | null; provider: string; assignee_type: string; assigned_to_user_id: string | null; lead_id: string | null; contact_display_name: string | null; contact_phone: string | null };

      // Only while nobody owns the chat: if a counsellor accepted in the meantime, leave their chat alone.
      const { data: flagged } = await db
        .from("conversations")
        .update({ ai_autonomy: "off", meta: { ...(c.meta ?? {}), needs_human: { at: new Date().toISOString(), reason } } })
        .eq("id", conversationId)
        .eq("tenant_id", tenantId)
        .or(OWNERLESS_FILTER)
        .select("id")
        .maybeSingle();
      if (!flagged) return;

      try {
        const { userIds } = await resolveInboundRecipients(db, {
          tenantId,
          provider: c.provider,
          assigneeType: c.assignee_type,
          assignedToUserId: c.assigned_to_user_id,
          leadId: c.lead_id,
        });
        const who = c.contact_display_name || c.contact_phone || "A visitor";
        await Promise.all(
          userIds.map((userId) =>
            upsertThreadNotification({
              tenantId,
              userId,
              type: NotificationTypes.INBOX_MESSAGE_RECEIVED,
              title: "Needs a human",
              message: reason === "asked_for_person" ? `${who} asked for a person` : `${who} asked something the AI could not answer`,
              link: `/inbox?conversation=${conversationId}`,
            })
          )
        );
      } catch (err) {
        logger.warn({ conversationId, err: err instanceof Error ? err.message : String(err) }, "AI reply: could not notify the team (non-fatal)");
      }
    },
  };
}

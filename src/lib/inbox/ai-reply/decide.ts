// Should the AI answer this chat right now? Pure: every rule is one line here, so each can be tested alone.
// A "skip" always means "send nothing": the chat just waits for a person, exactly as it did before AI replies.

import { ownerOf, requiresClaim } from "@/lib/inbox/claim-rules";
import { AI_REPLY_INDUSTRY, type AiReplyConfig } from "./config";

export interface AiReplyFacts {
  serverEnabled: boolean;
  tenantAiEnabled: boolean;
  industryId: string | null;
  channelConfig: AiReplyConfig;
  conversation: {
    provider: string;
    status: string;
    ai_autonomy: string;
    assignee_type: string | null;
    assigned_to_user_id: string | null;
  };
  /** Who wrote the newest message in the chat. */
  lastAuthorType: string | null;
}

export type SkipReason =
  | "server_disabled"
  | "tenant_ai_off"
  | "wrong_industry"
  | "channel_ai_off"
  | "not_website_chat"
  | "not_open"
  | "chat_ai_off"
  | "human_owns_chat"
  | "visitor_not_last";

export type AiReplyDecision = { answer: true } | { answer: false; reason: SkipReason };

export function decideAiReply(f: AiReplyFacts): AiReplyDecision {
  const skip = (reason: SkipReason): AiReplyDecision => ({ answer: false, reason });
  if (!f.serverEnabled) return skip("server_disabled");
  if (!f.tenantAiEnabled) return skip("tenant_ai_off");
  if (f.industryId !== AI_REPLY_INDUSTRY) return skip("wrong_industry");
  if (!f.channelConfig.enabled || !f.channelConfig.siteId) return skip("channel_ai_off");
  if (!requiresClaim(f.conversation.provider)) return skip("not_website_chat");
  if (f.conversation.status !== "open") return skip("not_open");
  if (f.conversation.ai_autonomy !== "autonomous") return skip("chat_ai_off");
  if (ownerOf(f.conversation)) return skip("human_owns_chat");
  if (f.lastAuthorType !== "customer") return skip("visitor_not_last");
  return { answer: true };
}

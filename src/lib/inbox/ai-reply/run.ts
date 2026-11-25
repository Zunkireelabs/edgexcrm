// One AI reply, start to finish. All outside work (database, the Admizz AI, sending) comes in through `deps`, so the rules
// here (when to answer, when to hand over, what to drop) are unit-tested without a network or a database.

import { logger } from "@/lib/logger";
import { decideAiReply, type SkipReason } from "./decide";
import { HANDOFF_MESSAGE, readAiReplyConfig, type NeedsHumanReason } from "./config";
import { buildQuestion, type ChatLine } from "./question";
import type { AskInput, SearchAnswer } from "./search-client";

export interface ChatState {
  channelMeta: unknown;
  tenant: { ai_enabled: boolean; industry_id: string | null };
  conversation: {
    provider: string;
    status: string;
    ai_autonomy: string;
    assignee_type: string | null;
    assigned_to_user_id: string | null;
  };
  lastAuthorType: string | null;
  /** The newest message that is not a team-only note: lets the run notice that the visitor wrote again while the AI was thinking. */
  lastMessageId: string | null;
  /** The newest messages, oldest first. */
  lines: ChatLine[];
}

export interface AiReplyDeps {
  /** null when the server settings are missing (feature off). */
  env: { url: string; key: string } | null;
  loadState(tenantId: string, conversationId: string): Promise<ChatState | null>;
  /** The id of the newest non-system message right now (compared with the one the answer was built from). */
  latestMessageId(tenantId: string, conversationId: string): Promise<string | null>;
  /** Asked again just before sending: a counsellor may have clicked Accept while the AI was thinking. */
  stillUnowned(tenantId: string, conversationId: string): Promise<boolean>;
  ask(input: AskInput): Promise<SearchAnswer>;
  sendAi(args: { tenantId: string; conversationId: string; text: string; kind: "answer" | "handoff"; reason: NeedsHumanReason | null; siteId: string }): Promise<{ status: string }>;
  markHandoff(args: { tenantId: string; conversationId: string; reason: NeedsHumanReason }): Promise<void>;
}

export type AiReplyResult =
  | { done: "answered" }
  | { done: "handed_over"; reason: NeedsHumanReason }
  | { done: "skipped"; reason: SkipReason | "no_question" | "search_failed" | "taken_while_thinking" | "newer_message" | "empty_answer" | "send_failed" };

export async function runAiReply(ev: { tenantId: string; conversationId: string }, deps: AiReplyDeps): Promise<AiReplyResult> {
  const state = await deps.loadState(ev.tenantId, ev.conversationId);
  if (!state) return { done: "skipped", reason: "not_open" };

  const channelConfig = readAiReplyConfig(state.channelMeta);
  const decision = decideAiReply({
    serverEnabled: deps.env !== null,
    tenantAiEnabled: state.tenant.ai_enabled,
    industryId: state.tenant.industry_id,
    channelConfig,
    conversation: state.conversation,
    lastAuthorType: state.lastAuthorType,
  });
  if (!decision.answer) return { done: "skipped", reason: decision.reason };

  const question = buildQuestion(state.lines);
  if (!question) return { done: "skipped", reason: "no_question" };

  let answer: SearchAnswer;
  try {
    answer = await deps.ask({
      url: deps.env!.url,
      key: deps.env!.key,
      siteId: channelConfig.siteId,
      sessionId: ev.conversationId,
      question,
    });
  } catch (err) {
    // Never the visitor's words: ids and the error only. The chat simply waits for a person, as before.
    logger.warn({ conversationId: ev.conversationId, err: err instanceof Error ? err.message : String(err) }, "AI reply: the Admizz AI did not answer");
    return { done: "skipped", reason: "search_failed" };
  }

  // The visitor wrote again while the AI was thinking: this answer covers only the older words, so drop it. The caller runs
  // again (after the quiet period) and answers everything at once.
  if ((await deps.latestMessageId(ev.tenantId, ev.conversationId)) !== state.lastMessageId) return { done: "skipped", reason: "newer_message" };

  if (!(await deps.stillUnowned(ev.tenantId, ev.conversationId))) return { done: "skipped", reason: "taken_while_thinking" };

  if (answer.needsHuman) {
    const reason = answer.reason ?? "out_of_knowledge";
    try {
      await deps.sendAi({ ...ev, text: HANDOFF_MESSAGE, kind: "handoff", reason, siteId: channelConfig.siteId });
    } catch (err) {
      logger.warn({ conversationId: ev.conversationId, err: err instanceof Error ? err.message : String(err) }, "AI reply: hand-off message was not sent");
    }
    // Flag the chat even if the message failed, so the team still sees that a person is needed.
    await deps.markHandoff({ ...ev, reason });
    return { done: "handed_over", reason };
  }

  if (!answer.answer) return { done: "skipped", reason: "empty_answer" };

  const sent = await deps.sendAi({ ...ev, text: answer.answer, kind: "answer", reason: null, siteId: channelConfig.siteId });
  if (sent.status === "failed") return { done: "skipped", reason: "send_failed" };
  return { done: "answered" };
}

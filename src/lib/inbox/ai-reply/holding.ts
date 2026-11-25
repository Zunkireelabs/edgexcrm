// The "holding message": while AI replies are OFF, a visitor to the Admizz website chat gets ONE automatic message saying the team
// has the chat, instead of silence. When AI replies are on, the AI answers and this never sends.
// Same shape as run.ts: every outside action comes in through `deps`, so the rules are unit-tested without a network or database.

import { logger } from "@/lib/logger";
import { ownerOf, requiresClaim } from "@/lib/inbox/claim-rules";
import { AI_REPLY_INDUSTRY, HOLDING_MESSAGE, readAiReplyConfig } from "./config";
import type { AiReplyDeps, ChatState } from "./run";

export type HoldingSkipReason =
  | "wrong_industry"
  | "not_website_chat"
  | "not_open"
  | "human_owns_chat"
  | "visitor_not_last"
  | "ai_is_on"
  | "already_sent"
  | "taken_while_sending"
  | "send_failed";

export type HoldingDecision = { send: true } | { send: false; reason: HoldingSkipReason };

/** Is the AI going to answer this chat? Off for any of: server setting, tenant switch, website-chat switch. */
function aiWillAnswer(serverEnabled: boolean, state: ChatState): boolean {
  const cfg = readAiReplyConfig(state.channelMeta);
  return serverEnabled && state.tenant.ai_enabled && cfg.enabled && !!cfg.siteId;
}

export function decideHoldingMessage(serverEnabled: boolean, state: ChatState): HoldingDecision {
  const skip = (reason: HoldingSkipReason): HoldingDecision => ({ send: false, reason });
  if (state.tenant.industry_id !== AI_REPLY_INDUSTRY) return skip("wrong_industry");
  if (!requiresClaim(state.conversation.provider)) return skip("not_website_chat");
  if (state.conversation.status !== "open") return skip("not_open");
  if (ownerOf(state.conversation)) return skip("human_owns_chat");
  if (state.lastAuthorType !== "customer") return skip("visitor_not_last");
  // AI on (even if it later hands the chat over): the AI flow owns the conversation, so no holding message.
  if (aiWillAnswer(serverEnabled, state)) return skip("ai_is_on");
  return { send: true };
}

export interface HoldingDeps {
  serverEnabled: boolean;
  loadState: AiReplyDeps["loadState"];
  stillUnowned: AiReplyDeps["stillUnowned"];
  sendAi: AiReplyDeps["sendAi"];
  /** Atomically record "holding message sent" on the chat. true only for the ONE caller that got to record it. */
  claimHolding(tenantId: string, conversationId: string): Promise<boolean>;
  /** Undo the record when the message could not be sent, so the next visitor message tries again. */
  releaseHolding(tenantId: string, conversationId: string): Promise<void>;
}

export type HoldingResult = { done: "sent" } | { done: "skipped"; reason: HoldingSkipReason };

export async function runHoldingMessage(ev: { tenantId: string; conversationId: string }, deps: HoldingDeps): Promise<HoldingResult> {
  const state = await deps.loadState(ev.tenantId, ev.conversationId);
  if (!state) return { done: "skipped", reason: "not_open" };

  const decision = decideHoldingMessage(deps.serverEnabled, state);
  if (!decision.send) return { done: "skipped", reason: decision.reason };

  // Record first (atomic), send second: two quick visitor messages can never both send it.
  if (!(await deps.claimHolding(ev.tenantId, ev.conversationId))) return { done: "skipped", reason: "already_sent" };

  try {
    // A counsellor may have clicked Accept in the last moment: then the chat is theirs and a bot message would be noise.
    if (!(await deps.stillUnowned(ev.tenantId, ev.conversationId))) {
      await deps.releaseHolding(ev.tenantId, ev.conversationId);
      return { done: "skipped", reason: "taken_while_sending" };
    }
    const sent = await deps.sendAi({ ...ev, text: HOLDING_MESSAGE, kind: "holding", reason: null, siteId: readAiReplyConfig(state.channelMeta).siteId });
    if (sent.status === "failed") {
      await deps.releaseHolding(ev.tenantId, ev.conversationId);
      return { done: "skipped", reason: "send_failed" };
    }
    return { done: "sent" };
  } catch (err) {
    await deps.releaseHolding(ev.tenantId, ev.conversationId).catch(() => {});
    logger.warn({ conversationId: ev.conversationId, err: err instanceof Error ? err.message : String(err) }, "Holding message was not sent");
    return { done: "skipped", reason: "send_failed" };
  }
}

/** Chats already handled in this process (sent, or recorded as sent): skips three database reads on every later message. */
const handled = new Set<string>();
/** Chats with a holding run in flight right now: two quick visitor messages never run it twice at once. */
const inFlight = new Set<string>();
const MAX_REMEMBERED = 5_000;

/** Ask for the holding message for this chat. Returns at once, never throws. */
export function scheduleHoldingMessage(ev: { tenantId: string; conversationId: string }, deps: () => HoldingDeps): void {
  if (handled.has(ev.conversationId) || inFlight.has(ev.conversationId)) return;
  inFlight.add(ev.conversationId);
  void (async () => {
    try {
      const result = await runHoldingMessage(ev, deps());
      if (result.done === "sent" || (result.done === "skipped" && result.reason === "already_sent")) {
        if (handled.size >= MAX_REMEMBERED) handled.clear();
        handled.add(ev.conversationId);
      }
    } catch (err) {
      // Never the visitor's words: ids and the error only. The chat waits for a person, exactly as before.
      logger.warn({ conversationId: ev.conversationId, err: err instanceof Error ? err.message : String(err) }, "Holding message failed (the chat waits for a person)");
    } finally {
      inFlight.delete(ev.conversationId);
    }
  })();
}

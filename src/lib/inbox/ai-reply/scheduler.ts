// Runs an AI reply a few seconds after a visitor's LAST message, inside this server process. Not Inngest: the Hobby plan's
// monthly limit stops Inngest starting any new run, which silently turned AI replies off (2026-11-25). The inbound message
// handling already runs in this process too, so this adds no new place for things to fail.
//
// What it guarantees:
//  - a burst of messages restarts one timer, so the chat gets ONE answer;
//  - never two runs for the same chat at once (a message that arrives mid-run queues one more run afterwards);
//  - a run that fails is logged and dropped: the chat waits for a person, exactly as before AI replies existed.
// What it does not: a pending timer is lost if the server restarts in those few seconds (the visitor's message is already
// saved and the chat is still listed as waiting, so a counsellor still sees it).

import { logger } from "@/lib/logger";
import { AI_REPLY_DEBOUNCE_MS } from "./config";
import { realAiReplyDeps } from "./deps";
import { scheduleHoldingMessage } from "./holding";
import { realHoldingDeps } from "./holding-deps";
import { runAiReply, type AiReplyResult } from "./run";

export interface AiReplyRequest {
  tenantId: string;
  conversationId: string;
}

export interface SchedulerOptions {
  run: (ev: AiReplyRequest) => Promise<AiReplyResult>;
  debounceMs?: number;
  /** The AI was on but could not answer (its service hit a limit or was down): the visitor still gets the "our team has your chat" message. */
  onAiFailed?: (ev: AiReplyRequest) => void;
}

/** Results where the AI should have answered but did not. A deliberate skip (counsellor took over, AI off) is not one of them. */
const AI_FAILED_REASONS = new Set(["search_failed", "empty_answer", "send_failed"]);

export function createAiReplyScheduler(opts: SchedulerOptions) {
  const delay = opts.debounceMs ?? AI_REPLY_DEBOUNCE_MS;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const running = new Set<string>();
  const again = new Map<string, AiReplyRequest>();

  async function execute(ev: AiReplyRequest): Promise<void> {
    const key = ev.conversationId;
    if (running.has(key)) {
      again.set(key, ev); // a run is in flight: go once more when it ends, so the newest words get answered
      return;
    }
    running.add(key);
    let rerun = false;
    try {
      const result = await opts.run(ev);
      // The visitor wrote again while the AI was thinking: that answer was dropped, so answer the whole burst now.
      rerun = result.done === "skipped" && result.reason === "newer_message";
      if (result.done === "skipped" && AI_FAILED_REASONS.has(result.reason)) opts.onAiFailed?.(ev);
    } catch (err) {
      opts.onAiFailed?.(ev);
      // Never the visitor's words: ids and the error only.
      logger.warn({ conversationId: key, err: err instanceof Error ? err.message : String(err) }, "AI reply failed (the chat waits for a person)");
    } finally {
      running.delete(key);
    }
    const queued = again.get(key);
    again.delete(key);
    if (rerun || queued) schedule(queued ?? ev);
  }

  function schedule(ev: AiReplyRequest): void {
    const key = ev.conversationId;
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        void execute(ev);
      }, delay)
    );
  }

  return { schedule, pending: () => timers.size, running: () => running.size };
}

const shared = createAiReplyScheduler({
  run: (ev) => runAiReply(ev, realAiReplyDeps()),
  onAiFailed: (ev) => scheduleHoldingMessage(ev, realHoldingDeps, { aiFailed: true }),
});

/** Ask for an AI reply to this chat. Returns at once; the reply is sent after the quiet period. Never throws. */
export function scheduleAiReply(ev: AiReplyRequest): void {
  shared.schedule(ev);
}

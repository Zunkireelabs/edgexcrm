import { ageLabel } from "../time";
import type { DoNextItem, HomeConversation } from "../types";
import type { RuleCtx } from "./ctx";

/**
 * reply_waiting: a conversation on my lead (or assigned to me) whose last message is inbound and which isn't closed
 * or snoozed. Clears on any outbound message (last_message_direction flips). The caller has already narrowed
 * `conversations` to mine; this rule only judges the conversation state.
 */
export function replyWaitingRule(convs: HomeConversation[], ctx: RuleCtx): DoNextItem[] {
  const out: DoNextItem[] = [];
  for (const c of convs) {
    if (c.lastDirection !== "inbound") continue;
    if (c.status === "closed") continue;
    if (c.status === "snoozed" && c.snoozedUntil && Date.parse(c.snoozedUntil) > ctx.now.getTime()) continue;
    const at = Date.parse(c.lastMessageAt);
    out.push({
      key: `reply_waiting:${c.id}`,
      kind: "reply_waiting",
      tier: "now",
      leadId: c.leadId ?? undefined,
      title: c.contactName,
      why: c.preview ? `“${c.preview}”` : "New message",
      chip: { text: `Replied ${ageLabel(ctx.now.getTime() - at)} ago`, tone: "neutral" },
      tone: "neutral",
      primaryAction: { type: "reply", href: `/inbox?conversation=${c.id}` },
      sortKey: { group: 1, at },
      evidenceHref: `/inbox?conversation=${c.id}`,
      provider: c.provider,
    });
  }
  return out;
}

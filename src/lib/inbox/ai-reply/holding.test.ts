import { describe, it, expect, vi } from "vitest";
import { decideHoldingMessage, runHoldingMessage, scheduleHoldingMessage, type HoldingDeps } from "./holding";
import { HOLDING_MESSAGE } from "./config";
import type { ChatState } from "./run";

const AI_OFF_META = { website_chat_ai: { enabled: false, siteId: "" } };
const state = (over: Partial<ChatState> = {}): ChatState => ({
  channelMeta: AI_OFF_META,
  tenant: { ai_enabled: true, industry_id: "education_consultancy" },
  conversation: { provider: "chatwoot", status: "open", ai_autonomy: "off", assignee_type: "unassigned", assigned_to_user_id: null },
  lastAuthorType: "customer",
  lastMessageId: "m1",
  lines: [{ author_type: "customer", content_text: "Hi" }],
  ...over,
});
function deps(over: Partial<HoldingDeps> = {}, st: ChatState | null = state()): HoldingDeps {
  return {
    serverEnabled: false,
    loadState: vi.fn().mockResolvedValue(st),
    stillUnowned: vi.fn().mockResolvedValue(true),
    sendAi: vi.fn().mockResolvedValue({ status: "sent" }),
    claimHolding: vi.fn().mockResolvedValue(true),
    releaseHolding: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}
const ev = { tenantId: "t1", conversationId: "c1" };

describe("the holding message text", () => {
  it("names Admizz, never Flywire, and promises a follow-up channel", () => {
    expect(HOLDING_MESSAGE).toContain("Admizz");
    expect(HOLDING_MESSAGE).not.toMatch(/flywire/i);
    expect(HOLDING_MESSAGE).not.toMatch(/high volume/i);
    expect(HOLDING_MESSAGE).toMatch(/phone call, WhatsApp or email/);
  });
});

describe("decideHoldingMessage", () => {
  it("sends when AI replies are off, on any of the three switches", () => {
    expect(decideHoldingMessage(false, state())).toEqual({ send: true }); // server setting off
    expect(decideHoldingMessage(true, state({ channelMeta: AI_OFF_META }))).toEqual({ send: true }); // website-chat switch off
    expect(decideHoldingMessage(true, state({ channelMeta: { website_chat_ai: { enabled: true, siteId: "admizz-edu" } }, tenant: { ai_enabled: false, industry_id: "education_consultancy" } }))).toEqual({ send: true }); // tenant switch off
  });
  it("never sends when the AI is on (it answers, or hands over, itself)", () => {
    const on = state({ channelMeta: { website_chat_ai: { enabled: true, siteId: "admizz-edu" } } });
    expect(decideHoldingMessage(true, on)).toEqual({ send: false, reason: "ai_is_on" });
    // a chat the AI already handed to the team (autonomy off, needs_human) still belongs to the AI flow
    expect(decideHoldingMessage(true, { ...on, conversation: { ...on.conversation, ai_autonomy: "off" } })).toEqual({ send: false, reason: "ai_is_on" });
  });
  it("only for the Admizz education website chat, open, unowned, visitor last", () => {
    expect(decideHoldingMessage(false, state({ tenant: { ai_enabled: true, industry_id: "it_agency" } }))).toEqual({ send: false, reason: "wrong_industry" });
    expect(decideHoldingMessage(false, state({ conversation: { ...state().conversation, provider: "whatsapp" } }))).toEqual({ send: false, reason: "not_website_chat" });
    expect(decideHoldingMessage(false, state({ conversation: { ...state().conversation, status: "resolved" } }))).toEqual({ send: false, reason: "not_open" });
    expect(decideHoldingMessage(false, state({ conversation: { ...state().conversation, assignee_type: "human", assigned_to_user_id: "u1" } }))).toEqual({ send: false, reason: "human_owns_chat" });
    expect(decideHoldingMessage(false, state({ lastAuthorType: "ai_agent" }))).toEqual({ send: false, reason: "visitor_not_last" });
  });
});

describe("runHoldingMessage", () => {
  it("records first, then sends the fixed text as an AI-authored 'holding' message", async () => {
    const d = deps();
    expect(await runHoldingMessage(ev, d)).toEqual({ done: "sent" });
    expect(d.claimHolding).toHaveBeenCalledWith("t1", "c1");
    expect(d.sendAi).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "t1", conversationId: "c1", text: HOLDING_MESSAGE, kind: "holding", reason: null }));
    expect(d.releaseHolding).not.toHaveBeenCalled();
  });
  it("once per chat: an already-recorded chat sends nothing", async () => {
    const d = deps({ claimHolding: vi.fn().mockResolvedValue(false) });
    expect(await runHoldingMessage(ev, d)).toEqual({ done: "skipped", reason: "already_sent" });
    expect(d.sendAi).not.toHaveBeenCalled();
  });
  it("sends nothing, and records nothing, when a rule says skip", async () => {
    const d = deps({}, state({ conversation: { ...state().conversation, assignee_type: "human", assigned_to_user_id: "u1" } }));
    expect((await runHoldingMessage(ev, d)).done).toBe("skipped");
    expect(d.claimHolding).not.toHaveBeenCalled();
    expect(d.sendAi).not.toHaveBeenCalled();
    const gone = deps({}, null);
    expect((await runHoldingMessage(ev, gone)).done).toBe("skipped");
  });
  it("a counsellor accepting at the last moment cancels it and releases the record", async () => {
    const d = deps({ stillUnowned: vi.fn().mockResolvedValue(false) });
    expect(await runHoldingMessage(ev, d)).toEqual({ done: "skipped", reason: "taken_while_sending" });
    expect(d.sendAi).not.toHaveBeenCalled();
    expect(d.releaseHolding).toHaveBeenCalledTimes(1);
  });
  it("a failed or throwing send releases the record so the next visitor message tries again", async () => {
    const failed = deps({ sendAi: vi.fn().mockResolvedValue({ status: "failed" }) });
    expect(await runHoldingMessage(ev, failed)).toEqual({ done: "skipped", reason: "send_failed" });
    expect(failed.releaseHolding).toHaveBeenCalledTimes(1);
    const boom = deps({ sendAi: vi.fn().mockRejectedValue(new Error("down")) });
    expect(await runHoldingMessage(ev, boom)).toEqual({ done: "skipped", reason: "send_failed" });
    expect(boom.releaseHolding).toHaveBeenCalledTimes(1);
  });
});

describe("scheduleHoldingMessage", () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  it("two quick visitor messages run it once, and a sent chat is not looked at again", async () => {
    const d = deps();
    const e = { tenantId: "t1", conversationId: "c-quick" };
    scheduleHoldingMessage(e, () => d);
    scheduleHoldingMessage(e, () => d);
    await flush();
    expect(d.sendAi).toHaveBeenCalledTimes(1);
    scheduleHoldingMessage(e, () => d);
    await flush();
    expect(d.loadState).toHaveBeenCalledTimes(1);
  });
  it("never throws, even when the database side blows up", async () => {
    const d = deps({ loadState: vi.fn().mockRejectedValue(new Error("db")) });
    expect(() => scheduleHoldingMessage({ tenantId: "t1", conversationId: "c-boom" }, () => d)).not.toThrow();
    await flush();
  });
});

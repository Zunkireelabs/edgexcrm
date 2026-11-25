import { describe, it, expect, vi } from "vitest";
import { runAiReply, type AiReplyDeps, type ChatState } from "./run";
import { HANDOFF_MESSAGE } from "./config";

const state = (over: Partial<ChatState> = {}): ChatState => ({
  channelMeta: { website_chat_ai: { enabled: true, siteId: "admizz-edu" } },
  tenant: { ai_enabled: true, industry_id: "education_consultancy" },
  conversation: { provider: "chatwoot", status: "open", ai_autonomy: "autonomous", assignee_type: "unassigned", assigned_to_user_id: null },
  lastAuthorType: "customer",
  lastMessageId: "m1",
  lines: [{ author_type: "customer", content_text: "Study in the UK" }],
  ...over,
});

function deps(over: Partial<AiReplyDeps> = {}, st: ChatState | null = state()): AiReplyDeps & { calls: Record<string, ReturnType<typeof vi.fn>> } {
  const d = {
    env: { url: "https://api.example.com", key: "k" },
    loadState: vi.fn().mockResolvedValue(st),
    latestMessageId: vi.fn().mockResolvedValue("m1"),
    stillUnowned: vi.fn().mockResolvedValue(true),
    ask: vi.fn().mockResolvedValue({ answer: "The UK has great universities.", needsHuman: false, reason: null }),
    sendAi: vi.fn().mockResolvedValue({ status: "sent" }),
    markHandoff: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
  return { ...d, calls: d as unknown as Record<string, ReturnType<typeof vi.fn>> };
}
const ev = { tenantId: "t1", conversationId: "c1" };

describe("runAiReply", () => {
  it("asks the AI with the chat as the session and sends its answer as an AI message", async () => {
    const d = deps();
    expect(await runAiReply(ev, d)).toEqual({ done: "answered" });
    expect(d.ask).toHaveBeenCalledWith({ url: "https://api.example.com", key: "k", siteId: "admizz-edu", sessionId: "c1", question: "Study in the UK" });
    expect(d.sendAi).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "t1", conversationId: "c1", text: "The UK has great universities.", kind: "answer" }));
    expect(d.markHandoff).not.toHaveBeenCalled();
  });

  it("sends nothing (and does not even ask the AI) when a rule says skip", async () => {
    for (const st of [
      state({ tenant: { ai_enabled: false, industry_id: "education_consultancy" } }),
      state({ conversation: { provider: "chatwoot", status: "open", ai_autonomy: "autonomous", assignee_type: "human", assigned_to_user_id: "u1" } }),
      state({ conversation: { provider: "chatwoot", status: "open", ai_autonomy: "off", assignee_type: "unassigned", assigned_to_user_id: null } }),
      state({ lastAuthorType: "ai_agent" }),
      state({ channelMeta: {} }),
    ]) {
      const d = deps({}, st);
      expect((await runAiReply(ev, d)).done).toBe("skipped");
      expect(d.ask).not.toHaveBeenCalled();
      expect(d.sendAi).not.toHaveBeenCalled();
    }
  });

  it("is off when the server settings are missing", async () => {
    const d = deps({ env: null });
    expect(await runAiReply(ev, d)).toEqual({ done: "skipped", reason: "server_disabled" });
    expect(d.ask).not.toHaveBeenCalled();
  });

  it("skips when the chat is gone, or the visitor said nothing new", async () => {
    expect((await runAiReply(ev, deps({}, null))).done).toBe("skipped");
    expect(await runAiReply(ev, deps({}, state({ lines: [{ author_type: "customer", content_text: " " }] })))).toEqual({ done: "skipped", reason: "no_question" });
  });

  it("when the AI cannot be reached, sends nothing and the chat waits for a person", async () => {
    const d = deps({ ask: vi.fn().mockRejectedValue(new Error("timeout")) });
    expect(await runAiReply(ev, d)).toEqual({ done: "skipped", reason: "search_failed" });
    expect(d.sendAi).not.toHaveBeenCalled();
    expect(d.markHandoff).not.toHaveBeenCalled();
  });

  it("drops the answer if a counsellor accepted while the AI was thinking", async () => {
    const d = deps({ stillUnowned: vi.fn().mockResolvedValue(false) });
    expect(await runAiReply(ev, d)).toEqual({ done: "skipped", reason: "taken_while_thinking" });
    expect(d.sendAi).not.toHaveBeenCalled();
  });

  it("drops the answer when the visitor wrote again while the AI was thinking (the burst is answered in one go next time)", async () => {
    const d = deps({ latestMessageId: vi.fn().mockResolvedValue("m2") });
    expect(await runAiReply(ev, d)).toEqual({ done: "skipped", reason: "newer_message" });
    expect(d.sendAi).not.toHaveBeenCalled();
    expect(d.markHandoff).not.toHaveBeenCalled();
  });

  it("an empty answer sends nothing", async () => {
    const d = deps({ ask: vi.fn().mockResolvedValue({ answer: "", needsHuman: false, reason: null }) });
    expect(await runAiReply(ev, d)).toEqual({ done: "skipped", reason: "empty_answer" });
    expect(d.sendAi).not.toHaveBeenCalled();
  });

  it("a failed send is reported, not counted as answered", async () => {
    const d = deps({ sendAi: vi.fn().mockResolvedValue({ status: "failed" }) });
    expect(await runAiReply(ev, d)).toEqual({ done: "skipped", reason: "send_failed" });
  });

  describe("hand-off", () => {
    const needsHuman = { answer: "I don't have that detail yet.", needsHuman: true, reason: "out_of_knowledge" as const };

    it("tells the visitor a counsellor will reply (not the AI's own words) and flags the chat", async () => {
      const d = deps({ ask: vi.fn().mockResolvedValue(needsHuman) });
      expect(await runAiReply(ev, d)).toEqual({ done: "handed_over", reason: "out_of_knowledge" });
      expect(d.sendAi).toHaveBeenCalledTimes(1);
      expect(d.sendAi).toHaveBeenCalledWith(expect.objectContaining({ text: HANDOFF_MESSAGE, kind: "handoff", reason: "out_of_knowledge" }));
      expect(d.markHandoff).toHaveBeenCalledWith({ tenantId: "t1", conversationId: "c1", reason: "out_of_knowledge" });
    });

    it("keeps the reason when the visitor asked for a person", async () => {
      const d = deps({ ask: vi.fn().mockResolvedValue({ ...needsHuman, reason: "asked_for_person" }) });
      expect(await runAiReply(ev, d)).toEqual({ done: "handed_over", reason: "asked_for_person" });
    });

    it("still flags the chat when the hand-off message could not be sent, so the team sees it", async () => {
      const d = deps({ ask: vi.fn().mockResolvedValue(needsHuman), sendAi: vi.fn().mockRejectedValue(new Error("chatwoot down")) });
      expect(await runAiReply(ev, d)).toEqual({ done: "handed_over", reason: "out_of_knowledge" });
      expect(d.markHandoff).toHaveBeenCalled();
    });

    it("does not hand over a chat a counsellor accepted meanwhile", async () => {
      const d = deps({ ask: vi.fn().mockResolvedValue(needsHuman), stillUnowned: vi.fn().mockResolvedValue(false) });
      expect(await runAiReply(ev, d)).toEqual({ done: "skipped", reason: "taken_while_thinking" });
      expect(d.sendAi).not.toHaveBeenCalled();
      expect(d.markHandoff).not.toHaveBeenCalled();
    });
  });
});

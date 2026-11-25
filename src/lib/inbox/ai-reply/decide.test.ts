import { describe, it, expect } from "vitest";
import { decideAiReply, type AiReplyFacts } from "./decide";

const base: AiReplyFacts = {
  serverEnabled: true,
  tenantAiEnabled: true,
  industryId: "education_consultancy",
  channelConfig: { enabled: true, siteId: "admizz-edu" },
  conversation: { provider: "chatwoot", status: "open", ai_autonomy: "autonomous", assignee_type: "unassigned", assigned_to_user_id: null },
  lastAuthorType: "customer",
};
const skip = (over: Partial<AiReplyFacts>) => decideAiReply({ ...base, ...over });

describe("decideAiReply", () => {
  it("answers an open, unaccepted Admizz website chat where the visitor spoke last", () => {
    expect(decideAiReply(base)).toEqual({ answer: true });
  });
  it.each([
    ["server_disabled", { serverEnabled: false }],
    ["tenant_ai_off", { tenantAiEnabled: false }],
    ["wrong_industry", { industryId: "it_agency" }],
    ["channel_ai_off", { channelConfig: { enabled: false, siteId: "x" } }],
    ["channel_ai_off", { channelConfig: { enabled: true, siteId: "" } }],
    ["visitor_not_last", { lastAuthorType: "ai_agent" }],
    ["visitor_not_last", { lastAuthorType: "human_agent" }],
    ["visitor_not_last", { lastAuthorType: null }],
  ] as const)("skips: %s", (reason, over) => {
    expect(skip(over as Partial<AiReplyFacts>)).toEqual({ answer: false, reason });
  });
  it("skips other channels, closed or snoozed chats, and chats with AI turned off", () => {
    const conv = base.conversation;
    expect(skip({ conversation: { ...conv, provider: "whatsapp" } })).toEqual({ answer: false, reason: "not_website_chat" });
    expect(skip({ conversation: { ...conv, status: "closed" } })).toEqual({ answer: false, reason: "not_open" });
    expect(skip({ conversation: { ...conv, status: "snoozed" } })).toEqual({ answer: false, reason: "not_open" });
    expect(skip({ conversation: { ...conv, ai_autonomy: "off" } })).toEqual({ answer: false, reason: "chat_ai_off" });
    expect(skip({ conversation: { ...conv, ai_autonomy: "suggest" } })).toEqual({ answer: false, reason: "chat_ai_off" });
  });
  it("never answers once a person has accepted the chat", () => {
    expect(skip({ conversation: { ...base.conversation, assignee_type: "human", assigned_to_user_id: "u1" } })).toEqual({ answer: false, reason: "human_owns_chat" });
  });
  it("a 'human' owner whose user was deleted counts as nobody (same rule as Accept)", () => {
    expect(skip({ conversation: { ...base.conversation, assignee_type: "human", assigned_to_user_id: null } })).toEqual({ answer: true });
  });
});

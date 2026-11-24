import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthContext } from "@/lib/api/auth";

// POST /inbox/conversations/[id]/messages — on a website chat only the person who accepted it may reply.
// The rest of this route (attachments, drafts, scoping) has its own behaviour; this pins only the lock.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const authMock = vi.fn();
const sendMessageMock = vi.fn(async (input: Row) => {
  void input;
  return { messageId: "m1", providerMessageId: null, status: "sent" };
});
let conv: Row;

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: () => authMock() }));
vi.mock("@/lib/inbox/send-message", () => ({ sendMessage: (i: Row) => sendMessageMock(i) }));
vi.mock("@/lib/inbox/scope", () => ({ canAccessConversationLead: async () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({}),
  createServiceClient: async () => ({
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { user_metadata: { name: id === "manish" ? "Manish" : "Other" } } } }) } },
    from: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: { ...conv }, error: null }) };
      return b;
    },
  }),
}));

import { POST } from "./route";

const AUTH = (userId: string) => ({ userId, tenantId: "t", role: "staff", permissions: {} }) as unknown as AuthContext;
const req = () => ({ headers: { get: () => "application/json" }, json: async () => ({ content: "Hello Ram" }) }) as never;
const call = () => POST(req(), { params: Promise.resolve({ id: "conv-1" }) });

beforeEach(() => {
  sendMessageMock.mockClear();
  conv = { id: "conv-1", tenant_id: "t", lead_id: null, provider: "chatwoot", assignee_type: "human", assigned_to_user_id: "manish" };
  authMock.mockReset().mockResolvedValue(AUTH("manish"));
});

describe("reply lock on POST /messages", () => {
  it("the owner can reply", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock.mock.calls[0][0]).toMatchObject({ conversationId: "conv-1", author: { type: "human_agent", userId: "manish" } });
  });

  it("someone else is refused with 403 and nothing is sent to the visitor", async () => {
    authMock.mockResolvedValue(AUTH("bijay"));
    const res = await call();
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error.code).toBe("NOT_CHAT_OWNER");
    expect(json.error.message).toContain("Manish is handling this chat");
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("a chat nobody has accepted can't be replied to by anyone", async () => {
    conv = { ...conv, assignee_type: "unassigned", assigned_to_user_id: null };
    const res = await call();
    expect(res.status).toBe(403);
    expect((await res.json()).error.message).toContain("Accept it to reply");
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("WhatsApp is unchanged: anyone who could reply before still can, even unassigned", async () => {
    conv = { ...conv, provider: "whatsapp", assignee_type: "unassigned", assigned_to_user_id: null };
    authMock.mockResolvedValue(AUTH("bijay"));
    const res = await call();
    expect(res.status).toBe(200);
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
  });
});

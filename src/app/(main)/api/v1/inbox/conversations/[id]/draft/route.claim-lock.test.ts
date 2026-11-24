import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthContext } from "@/lib/api/auth";

// POST /inbox/conversations/[id]/draft — approving a draft sends it, so the same lock applies on website chats.

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
    auth: { admin: { getUserById: async () => ({ data: { user: { user_metadata: { name: "Manish" } } } }) } },
    from: (table: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => ({ data: table === "conversations" ? { ...conv } : { content_text: "Draft text", status: "draft" }, error: null }),
      };
      return b;
    },
  }),
}));

import { POST } from "./route";

const AUTH = (userId: string) => ({ userId, tenantId: "t", role: "staff", permissions: {} }) as unknown as AuthContext;
const call = () => POST({ json: async () => ({ draft_message_id: "d1" }) } as never, { params: Promise.resolve({ id: "conv-1" }) });

beforeEach(() => {
  sendMessageMock.mockClear();
  conv = { id: "conv-1", tenant_id: "t", lead_id: null, provider: "chatwoot", assignee_type: "human", assigned_to_user_id: "manish" };
  authMock.mockReset().mockResolvedValue(AUTH("manish"));
});

describe("reply lock on POST /draft", () => {
  it("the owner can approve a draft", async () => {
    expect((await call()).status).toBe(200);
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
  });
  it("someone else is refused and the draft is not sent", async () => {
    authMock.mockResolvedValue(AUTH("bijay"));
    const res = await call();
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("NOT_CHAT_OWNER");
    expect(sendMessageMock).not.toHaveBeenCalled();
  });
  it("WhatsApp is unchanged", async () => {
    conv = { ...conv, provider: "whatsapp", assignee_type: "unassigned", assigned_to_user_id: null };
    authMock.mockResolvedValue(AUTH("bijay"));
    expect((await call()).status).toBe(200);
  });
});

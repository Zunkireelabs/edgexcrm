import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

const isAssistantEnabledMock = vi.fn();
const authenticateRequestMock = vi.fn();
const scopedClientMock = vi.fn();

vi.mock("@/lib/ai/flag", () => ({ isAssistantEnabled: isAssistantEnabledMock }));
vi.mock("@/lib/api/auth", () => ({ authenticateRequest: authenticateRequestMock }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: scopedClientMock }));

const OWNER_AUTH = { userId: "owner-1", tenantId: "tenant-1" } as unknown as AuthContext;
const OTHER_USER_AUTH = { userId: "intruder-1", tenantId: "tenant-1" } as unknown as AuthContext;

function fakeReq(): NextRequest {
  return {} as NextRequest;
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

/** Builds a scopedClient double whose `ai_conversations` select().eq("id",...).maybeSingle() resolves to `conversationRow`. */
function fakeDbWithConversation(conversationRow: Record<string, unknown> | null, opts?: { deleteError?: unknown }) {
  const conversationQuery = {
    eq: vi.fn(() => conversationQuery),
    maybeSingle: vi.fn(() => Promise.resolve({ data: conversationRow })),
  };
  const deleteQuery = {
    eq: vi.fn(() => Promise.resolve({ error: opts?.deleteError ?? null })),
  };
  return {
    from: vi.fn((table: string) => {
      if (table === "ai_conversations") {
        return {
          select: vi.fn(() => conversationQuery),
          delete: vi.fn(() => deleteQuery),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  };
}

describe("GET /api/v1/ai/conversations/[id]", () => {
  beforeEach(() => {
    isAssistantEnabledMock.mockReset();
    authenticateRequestMock.mockReset();
    scopedClientMock.mockReset();
  });

  it("returns 404 when the assistant flag is off", async () => {
    isAssistantEnabledMock.mockReturnValue(false);
    const { GET } = await import("./route");
    const res = await GET(fakeReq(), params("c1"));
    expect(res.status).toBe(404);
  });

  it("404s when the conversation belongs to a different user (own-only)", async () => {
    isAssistantEnabledMock.mockReturnValue(true);
    authenticateRequestMock.mockResolvedValue(OTHER_USER_AUTH);
    scopedClientMock.mockResolvedValue(
      fakeDbWithConversation({ id: "c1", user_id: "owner-1", title: "x", created_at: "t1", updated_at: "t2" })
    );

    const { GET } = await import("./route");
    const res = await GET(fakeReq(), params("c1"));
    expect(res.status).toBe(404);
  });

  it("404s when the conversation does not exist (or belongs to another tenant)", async () => {
    isAssistantEnabledMock.mockReturnValue(true);
    authenticateRequestMock.mockResolvedValue(OWNER_AUTH);
    scopedClientMock.mockResolvedValue(fakeDbWithConversation(null));

    const { GET } = await import("./route");
    const res = await GET(fakeReq(), params("missing"));
    expect(res.status).toBe(404);
  });

  it("returns the conversation and its messages for the owner", async () => {
    isAssistantEnabledMock.mockReturnValue(true);
    authenticateRequestMock.mockResolvedValue(OWNER_AUTH);

    const messages = [{ id: "m1", role: "user", content: {}, created_at: "t1" }];
    const conversationQuery = {
      eq: vi.fn(() => conversationQuery),
      maybeSingle: vi.fn(() =>
        Promise.resolve({ data: { id: "c1", user_id: "owner-1", title: "Chat", created_at: "t1", updated_at: "t2" } })
      ),
    };
    const messagesQuery = {
      eq: vi.fn(() => messagesQuery),
      order: vi.fn(() => Promise.resolve({ data: messages, error: null })),
    };
    scopedClientMock.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table === "ai_conversations") return { select: vi.fn(() => conversationQuery) };
        if (table === "ai_messages") return { select: vi.fn(() => messagesQuery) };
        throw new Error(`unexpected table: ${table}`);
      }),
    });

    const { GET } = await import("./route");
    const res = await GET(fakeReq(), params("c1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.conversation.id).toBe("c1");
    expect(body.data.messages).toEqual(messages);
  });
});

describe("DELETE /api/v1/ai/conversations/[id]", () => {
  beforeEach(() => {
    isAssistantEnabledMock.mockReset();
    authenticateRequestMock.mockReset();
    scopedClientMock.mockReset();
  });

  it("returns 404 when the assistant flag is off", async () => {
    isAssistantEnabledMock.mockReturnValue(false);
    const { DELETE } = await import("./route");
    const res = await DELETE(fakeReq(), params("c1"));
    expect(res.status).toBe(404);
  });

  it("404s deleting another user's conversation (cross-user)", async () => {
    isAssistantEnabledMock.mockReturnValue(true);
    authenticateRequestMock.mockResolvedValue(OTHER_USER_AUTH);
    scopedClientMock.mockResolvedValue(fakeDbWithConversation({ id: "c1", user_id: "owner-1" }));

    const { DELETE } = await import("./route");
    const res = await DELETE(fakeReq(), params("c1"));
    expect(res.status).toBe(404);
  });

  it("404s deleting a conversation from another tenant (scoped select finds nothing)", async () => {
    isAssistantEnabledMock.mockReturnValue(true);
    authenticateRequestMock.mockResolvedValue(OWNER_AUTH);
    scopedClientMock.mockResolvedValue(fakeDbWithConversation(null));

    const { DELETE } = await import("./route");
    const res = await DELETE(fakeReq(), params("foreign-tenant-convo"));
    expect(res.status).toBe(404);
  });

  it("deletes the conversation for its owner", async () => {
    isAssistantEnabledMock.mockReturnValue(true);
    authenticateRequestMock.mockResolvedValue(OWNER_AUTH);
    scopedClientMock.mockResolvedValue(fakeDbWithConversation({ id: "c1", user_id: "owner-1" }));

    const { DELETE } = await import("./route");
    const res = await DELETE(fakeReq(), params("c1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.id).toBe("c1");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

// Scoping must be exactly the conversation's: a signed URL for a message the caller
// can't see is as bad as being able to read the message itself
// (docs/INBOX-ATTACHMENTS-BRIEF.md §3b). The extra `path` check guards the narrower
// case: a caller who CAN see the conversation must still only mint a URL for a path
// that's actually attached to a message IN that conversation — never an arbitrary
// object in the shared inbox-media bucket.

const authenticateRequestMock = vi.fn();
const canAccessConversationLeadMock = vi.fn();
const getSignedDownloadUrlMock = vi.fn();

vi.mock("@/lib/api/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/auth")>("@/lib/api/auth");
  return { ...actual, authenticateRequest: authenticateRequestMock };
});
vi.mock("@/lib/inbox/scope", () => ({ canAccessConversationLead: canAccessConversationLeadMock }));
vi.mock("@/lib/storage/provider", () => ({
  getStorageProvider: () => ({ getSignedDownloadUrl: getSignedDownloadUrlMock }),
}));

const AUTH = { userId: "user-1", tenantId: "tenant-1", role: "owner" } as unknown as AuthContext;

function fakeReq(url: string): NextRequest {
  return { url } as unknown as NextRequest;
}

function params() {
  return { params: Promise.resolve({ id: "conv-1" }) };
}

function fakeDb(opts: { conv?: Record<string, unknown> | null; message?: Record<string, unknown> | null }) {
  return {
    from(table: string) {
      if (table === "conversations") {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.conv ?? null }) }) }) }) };
      }
      if (table === "messages") {
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.message ?? null }) }) }) }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: vi.fn(),
  createClient: vi.fn(async () => ({})),
}));

import { createServiceClient } from "@/lib/supabase/server";

describe("GET /api/v1/inbox/conversations/[id]/attachments/signed-url", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset();
    authenticateRequestMock.mockResolvedValue(AUTH);
    canAccessConversationLeadMock.mockReset();
    canAccessConversationLeadMock.mockResolvedValue(true);
    getSignedDownloadUrlMock.mockReset();
    getSignedDownloadUrlMock.mockResolvedValue("https://storage.example/signed?x=1");
    (createServiceClient as unknown as ReturnType<typeof vi.fn>).mockReset();
  });

  it("mints a signed URL when the path matches an attachment on a message in this conversation", async () => {
    (createServiceClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeDb({
        conv: { id: "conv-1", lead_id: "lead-1" },
        message: { attachments: [{ bucket: "inbox-media", path: "tenant-1/inbox/conv-1/msg-1-0.jpg" }] },
      })
    );

    const { GET } = await import("./route");
    const res = await GET(
      fakeReq("http://x/api?messageId=msg-1&path=tenant-1/inbox/conv-1/msg-1-0.jpg"),
      params()
    );
    const body = (await res.json()) as { data: { url: string } };

    expect(res.status).toBe(200);
    expect(body.data.url).toBe("https://storage.example/signed?x=1");
    expect(getSignedDownloadUrlMock).toHaveBeenCalledWith("inbox-media", "tenant-1/inbox/conv-1/msg-1-0.jpg", 300);
  });

  it("403s when the caller cannot access the conversation's lead (scoping)", async () => {
    canAccessConversationLeadMock.mockResolvedValue(false);
    (createServiceClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeDb({ conv: { id: "conv-1", lead_id: "lead-1" }, message: { attachments: [] } })
    );

    const { GET } = await import("./route");
    const res = await GET(fakeReq("http://x/api?messageId=msg-1&path=tenant-1/inbox/conv-1/msg-1-0.jpg"), params());

    expect(res.status).toBe(403);
    expect(getSignedDownloadUrlMock).not.toHaveBeenCalled();
  });

  it("403s when the path is not actually attached to that message (arbitrary-path guard)", async () => {
    (createServiceClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeDb({
        conv: { id: "conv-1", lead_id: "lead-1" },
        message: { attachments: [{ bucket: "inbox-media", path: "tenant-1/inbox/conv-1/msg-1-0.jpg" }] },
      })
    );

    const { GET } = await import("./route");
    const res = await GET(
      fakeReq("http://x/api?messageId=msg-1&path=some-other-tenant/inbox/x/y.jpg"),
      params()
    );

    expect(res.status).toBe(403);
    expect(getSignedDownloadUrlMock).not.toHaveBeenCalled();
  });

  it("404s when the conversation doesn't exist in this tenant", async () => {
    (createServiceClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(fakeDb({ conv: null }));

    const { GET } = await import("./route");
    const res = await GET(fakeReq("http://x/api?messageId=msg-1&path=a/b.jpg"), params());

    expect(res.status).toBe(404);
  });

  it("422s when messageId or path is missing", async () => {
    (createServiceClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(fakeDb({}));

    const { GET } = await import("./route");
    const res = await GET(fakeReq("http://x/api?messageId=msg-1"), params());

    expect(res.status).toBe(422);
  });
});

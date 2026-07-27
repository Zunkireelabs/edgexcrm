import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

const authenticateRequestMock = vi.fn();
const scopedClientMock = vi.fn();
const inngestSendMock = vi.fn();

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return { ...actual, authenticateRequest: authenticateRequestMock };
});
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: scopedClientMock }));
vi.mock("@/lib/inngest/client", () => ({ inngest: { send: inngestSendMock } }));

const ADMIN_AUTH = { userId: "user-1", tenantId: "tenant-1", role: "admin" } as unknown as AuthContext;
const VIEWER_AUTH = { userId: "user-2", tenantId: "tenant-1", role: "viewer" } as unknown as AuthContext;

function fakeReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const params = Promise.resolve({ id: "approval-1" });

function dbWithExisting(existing: { id: string; status: string } | null) {
  const updateSpy = vi.fn((row: Record<string, unknown>) => ({
    eq: vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(() => Promise.resolve({ data: { id: "approval-1", ...row }, error: null })),
      })),
    })),
  }));
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(() => Promise.resolve({ data: existing })) })) })),
      update: updateSpy,
    })),
    __updateSpy: updateSpy,
  };
}

describe("PATCH /api/v1/agent-approvals/[id]", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset();
    scopedClientMock.mockReset();
    inngestSendMock.mockReset().mockResolvedValue(undefined);
  });

  it("401s when unauthenticated", async () => {
    authenticateRequestMock.mockResolvedValue(null);
    const { PATCH } = await import("./route");

    const res = await PATCH(fakeReq({ decision: "approve" }), { params });

    expect(res.status).toBe(401);
  });

  it("403s for a non-owner/admin caller (tenant-scoped role gate)", async () => {
    authenticateRequestMock.mockResolvedValue(VIEWER_AUTH);
    const { PATCH } = await import("./route");

    const res = await PATCH(fakeReq({ decision: "approve" }), { params });

    expect(res.status).toBe(403);
    expect(scopedClientMock).not.toHaveBeenCalled();
  });

  it("422s for an invalid decision value", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    scopedClientMock.mockResolvedValue(dbWithExisting({ id: "approval-1", status: "pending" }));
    const { PATCH } = await import("./route");

    const res = await PATCH(fakeReq({ decision: "yes-please" }), { params });

    expect(res.status).toBe(422);
  });

  it("404s when the approval doesn't belong to this tenant (scopedClient's tenant filter)", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    scopedClientMock.mockResolvedValue(dbWithExisting(null));
    const { PATCH } = await import("./route");

    const res = await PATCH(fakeReq({ decision: "approve" }), { params });

    expect(res.status).toBe(404);
  });

  it("422s on re-decide — a non-pending approval cannot be decided again", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    scopedClientMock.mockResolvedValue(dbWithExisting({ id: "approval-1", status: "approved" }));
    const { PATCH } = await import("./route");

    const res = await PATCH(fakeReq({ decision: "reject" }), { params });
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error.details.decision[0]).toMatch(/already been decided/i);
    expect(inngestSendMock).not.toHaveBeenCalled();
  });

  it("approve: sets status approved, decided_by/decided_at, and sends the approval.decided event", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    const db = dbWithExisting({ id: "approval-1", status: "pending" });
    scopedClientMock.mockResolvedValue(db);
    const { PATCH } = await import("./route");

    const res = await PATCH(fakeReq({ decision: "approve" }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    const [sawUpdate] = db.__updateSpy.mock.calls[0];
    expect(sawUpdate.status).toBe("approved");
    expect(sawUpdate.decided_by).toBe("user-1");
    expect(sawUpdate.decided_at).toBeTruthy();
    expect(body.data.status).toBe("approved");
    expect(inngestSendMock).toHaveBeenCalledWith({ name: "agent/approval.decided", data: { approvalId: "approval-1", decision: "approved" } });
  });

  it("reject: sets status rejected and sends the approval.decided event with decision 'rejected'", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    const db = dbWithExisting({ id: "approval-1", status: "pending" });
    scopedClientMock.mockResolvedValue(db);
    const { PATCH } = await import("./route");

    const res = await PATCH(fakeReq({ decision: "reject" }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    const [sawUpdate] = db.__updateSpy.mock.calls[0];
    expect(sawUpdate.status).toBe("rejected");
    expect(body.data.status).toBe("rejected");
    expect(inngestSendMock).toHaveBeenCalledWith({ name: "agent/approval.decided", data: { approvalId: "approval-1", decision: "rejected" } });
  });

  it("still returns 200 if sending the Inngest event fails (non-blocking)", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    scopedClientMock.mockResolvedValue(dbWithExisting({ id: "approval-1", status: "pending" }));
    inngestSendMock.mockRejectedValue(new Error("inngest unreachable"));
    const { PATCH } = await import("./route");

    const res = await PATCH(fakeReq({ decision: "approve" }), { params });

    expect(res.status).toBe(200);
  });
});

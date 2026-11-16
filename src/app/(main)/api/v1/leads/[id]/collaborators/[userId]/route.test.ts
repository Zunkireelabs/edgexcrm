import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

const authenticateRequestMock = vi.fn();
const createServiceClientMock = vi.fn();
const createAuditLogMock = vi.fn();
const touchLeadUpdatedAtMock = vi.fn();

vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: authenticateRequestMock,
  getClientIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: createServiceClientMock }));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: createAuditLogMock }));
vi.mock("@/lib/leads/touch-updated-at", () => ({ touchLeadUpdatedAt: touchLeadUpdatedAtMock }));

function authWith(baseTier: string, userId: string): AuthContext {
  return {
    userId,
    tenantId: "tenant-1",
    permissions: { baseTier },
  } as unknown as AuthContext;
}

function fakeReq(): NextRequest {
  return { headers: new Headers() } as unknown as NextRequest;
}

function params(id: string, userId: string) {
  return { params: Promise.resolve({ id, userId }) };
}

function fakeDb({ lead = { id: "lead-1" }, existing = { user_id: "collab-1" }, deleteError = null } = {}) {
  const leadQuery = {
    select: vi.fn(() => leadQuery),
    eq: vi.fn(() => leadQuery),
    is: vi.fn(() => leadQuery),
    single: vi.fn(() => Promise.resolve({ data: lead })),
  };
  const collabSelectQuery = {
    select: vi.fn(() => collabSelectQuery),
    eq: vi.fn(() => collabSelectQuery),
    maybeSingle: vi.fn(() => Promise.resolve({ data: existing })),
  };
  const collabDeleteQuery = {
    delete: vi.fn(() => collabDeleteQuery),
    eq: vi.fn(() => collabDeleteQuery),
  };
  Object.assign(
    collabDeleteQuery,
    { then: (resolve: (v: { error: unknown }) => void) => resolve({ error: deleteError }) },
  );

  let collabCallCount = 0;
  return {
    from: vi.fn((table: string) => {
      if (table === "leads") return leadQuery;
      collabCallCount += 1;
      return collabCallCount === 1 ? collabSelectQuery : collabDeleteQuery;
    }),
  };
}

beforeEach(() => {
  authenticateRequestMock.mockReset();
  createServiceClientMock.mockReset();
  createAuditLogMock.mockReset();
  touchLeadUpdatedAtMock.mockReset();
  createServiceClientMock.mockResolvedValue(fakeDb());
});

describe("DELETE /api/v1/leads/[id]/collaborators/[userId]", () => {
  it("401s when unauthenticated", async () => {
    authenticateRequestMock.mockResolvedValue(null);
    const { DELETE } = await import("./route");
    const res = await DELETE(fakeReq(), params("lead-1", "collab-1"));
    expect(res.status).toBe(401);
  });

  it("allows a collaborator to remove themselves", async () => {
    authenticateRequestMock.mockResolvedValue(authWith("counselor", "collab-1"));
    const { DELETE } = await import("./route");
    const res = await DELETE(fakeReq(), params("lead-1", "collab-1"));
    expect(res.status).toBe(200);
  });

  it("403s when a non-admin tries to remove a DIFFERENT collaborator", async () => {
    authenticateRequestMock.mockResolvedValue(authWith("counselor", "someone-else"));
    const { DELETE } = await import("./route");
    const res = await DELETE(fakeReq(), params("lead-1", "collab-1"));
    expect(res.status).toBe(403);
  });

  it("allows owner to remove any collaborator", async () => {
    authenticateRequestMock.mockResolvedValue(authWith("owner", "owner-user"));
    const { DELETE } = await import("./route");
    const res = await DELETE(fakeReq(), params("lead-1", "collab-1"));
    expect(res.status).toBe(200);
  });

  it("allows admin to remove any collaborator", async () => {
    authenticateRequestMock.mockResolvedValue(authWith("admin", "admin-user"));
    const { DELETE } = await import("./route");
    const res = await DELETE(fakeReq(), params("lead-1", "collab-1"));
    expect(res.status).toBe(200);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

const authenticateRequestMock = vi.fn();
const scopedClientMock = vi.fn();
const getAgentDetailMock = vi.fn();

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return { ...actual, authenticateRequest: authenticateRequestMock };
});
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: scopedClientMock }));
vi.mock("@/lib/ai/agents/queries", () => ({ getAgentDetail: getAgentDetailMock }));

const ADMIN_AUTH = { userId: "user-1", tenantId: "tenant-1", role: "admin" } as unknown as AuthContext;
const VIEWER_AUTH = { userId: "user-2", tenantId: "tenant-1", role: "viewer" } as unknown as AuthContext;

function fakeReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const params = Promise.resolve({ id: "identity-1" });

describe("GET /api/v1/agent-identities/[id]", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset();
    getAgentDetailMock.mockReset();
  });

  it("returns 403 for a non-owner/admin caller", async () => {
    authenticateRequestMock.mockResolvedValue(VIEWER_AUTH);
    const { GET } = await import("./route");

    const res = await GET({} as NextRequest, { params });

    expect(res.status).toBe(403);
    expect(getAgentDetailMock).not.toHaveBeenCalled();
  });

  it("404s when the agent identity doesn't belong to this tenant", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    getAgentDetailMock.mockResolvedValue(null);
    const { GET } = await import("./route");

    const res = await GET({} as NextRequest, { params });

    expect(res.status).toBe(404);
    expect(getAgentDetailMock).toHaveBeenCalledWith("tenant-1", "identity-1");
  });

  it("returns the agent detail shape for an admin caller", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    const detail = {
      id: "identity-1",
      agentKey: "lead-triage",
      displayName: "Lead Triage",
      status: "active",
      positionName: "Sales Rep",
      createdAt: "2026-01-01",
      capabilities: { trigger: "When a new lead is created", reads: [], drafts: [], produces: [], guarantee: "..." },
      stats: { tasksCompleted: 1, successRate: 100, lastActive: "2026-01-02" },
      recentRuns: [],
      recentOutputs: [],
    };
    getAgentDetailMock.mockResolvedValue(detail);
    const { GET } = await import("./route");

    const res = await GET({} as NextRequest, { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual(detail);
  });
});

describe("PATCH /api/v1/agent-identities/[id]", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset();
    scopedClientMock.mockReset();
  });

  it("returns 403 for a non-owner/admin caller", async () => {
    authenticateRequestMock.mockResolvedValue(VIEWER_AUTH);
    const { PATCH } = await import("./route");

    const res = await PATCH(fakeReq({ status: "paused" }), { params });

    expect(res.status).toBe(403);
    expect(scopedClientMock).not.toHaveBeenCalled();
  });

  it("rejects a status outside active/paused", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    const { PATCH } = await import("./route");

    const res = await PATCH(fakeReq({ status: "disabled" }), { params });
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error.details.status[0]).toMatch(/active.*paused/i);
    expect(scopedClientMock).not.toHaveBeenCalled();
  });

  it("404s when the agent identity doesn't belong to this tenant", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    scopedClientMock.mockResolvedValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(() => Promise.resolve({ data: null })) })) })) })),
    });
    const { PATCH } = await import("./route");

    const res = await PATCH(fakeReq({ status: "paused" }), { params });

    expect(res.status).toBe(404);
  });

  it("persists the new status when the caller is admin and the id exists", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    const updatedRow = { id: "identity-1", agent_key: "lead-triage", display_name: "Lead Triage", position_id: "pos-1", status: "paused", created_at: "t1" };
    let sawUpdate: Record<string, unknown> | undefined;
    scopedClientMock.mockResolvedValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(() => Promise.resolve({ data: { id: "identity-1" } })) })) })),
        update: vi.fn((row: Record<string, unknown>) => {
          sawUpdate = row;
          return { eq: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: updatedRow, error: null })) })) })) };
        }),
      })),
    });
    const { PATCH } = await import("./route");

    const res = await PATCH(fakeReq({ status: "paused" }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(sawUpdate).toEqual({ status: "paused" });
    expect(body.data).toEqual(updatedRow);
  });
});

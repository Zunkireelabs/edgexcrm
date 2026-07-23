import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

const authenticateRequestMock = vi.fn();
const scopedClientMock = vi.fn();
const getAgentDefinitionsForIndustryMock = vi.fn();

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return { ...actual, authenticateRequest: authenticateRequestMock };
});
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: scopedClientMock }));
vi.mock("@/lib/ai/agents/registry", () => ({
  getAgentDefinitionsForIndustry: getAgentDefinitionsForIndustryMock,
}));

const ADMIN_AUTH = {
  userId: "user-1",
  tenantId: "tenant-1",
  role: "admin",
  industryId: "education_consultancy",
} as unknown as AuthContext;

const VIEWER_AUTH = {
  userId: "user-2",
  tenantId: "tenant-1",
  role: "viewer",
  industryId: "education_consultancy",
} as unknown as AuthContext;

function fakeReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const LEAD_TRIAGE_DEF = { key: "lead-triage", name: "Lead Triage", description: "Scores leads" };

describe("POST /api/v1/agent-identities", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset();
    scopedClientMock.mockReset();
    getAgentDefinitionsForIndustryMock.mockReset();
    getAgentDefinitionsForIndustryMock.mockReturnValue([LEAD_TRIAGE_DEF]);
  });

  it("returns 403 for a non-owner/admin caller", async () => {
    authenticateRequestMock.mockResolvedValue(VIEWER_AUTH);
    const { POST } = await import("./route");

    const res = await POST(fakeReq({ agentKey: "lead-triage", positionId: "pos-1" }));

    expect(res.status).toBe(403);
    expect(scopedClientMock).not.toHaveBeenCalled();
  });

  it("rejects an agentKey that isn't in this tenant's industry catalog", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    const { POST } = await import("./route");

    const res = await POST(fakeReq({ agentKey: "some-other-industry-agent", positionId: "pos-1" }));
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error.details.agentKey[0]).toMatch(/unknown agent/i);
    expect(scopedClientMock).not.toHaveBeenCalled();
  });

  it("rejects a positionId that does not belong to this tenant", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    scopedClientMock.mockResolvedValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(() => Promise.resolve({ data: null })) })) })),
      })),
    });
    const { POST } = await import("./route");

    const res = await POST(fakeReq({ agentKey: "lead-triage", positionId: "not-in-tenant" }));
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error.details.positionId[0]).toMatch(/position not found/i);
  });

  it("hires the agent when the caller is admin, the key is valid, and the position belongs to the tenant", async () => {
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
    const insertedRow = { id: "identity-1", agent_key: "lead-triage", display_name: "Lead Triage", position_id: "pos-1", status: "active", created_at: "t1" };
    scopedClientMock.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table === "positions") {
          return { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(() => Promise.resolve({ data: { id: "pos-1" } })) })) })) };
        }
        return {
          insert: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: insertedRow, error: null })) })) })),
        };
      }),
    });
    const { POST } = await import("./route");

    const res = await POST(fakeReq({ agentKey: "lead-triage", positionId: "pos-1" }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data).toEqual(insertedRow);
  });
});

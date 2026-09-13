import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

const authenticateRequestMock = vi.fn();
const getFeatureAccessMock = vi.fn();
const scopedClientMock = vi.fn();
const assertLeadVisibleMock = vi.fn();

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: authenticateRequestMock }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: getFeatureAccessMock }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: scopedClientMock }));
vi.mock("@/lib/documents/access", () => ({ assertLeadVisible: assertLeadVisibleMock }));

const AUTH = { userId: "user-1", tenantId: "tenant-1", industryId: "education_consultancy" } as unknown as AuthContext;
const LEAD = { id: "lead-1", assigned_to: "user-1", branch_id: null, pipeline_id: "pipe-1", list_id: null };

function fakeReq(): NextRequest {
  return {} as unknown as NextRequest;
}

function params() {
  return { params: Promise.resolve({ id: "lead-1" }) };
}

function fakeDb(documents: Record<string, unknown>[]) {
  const query = {
    eq: vi.fn(() => query),
    is: vi.fn(() => query),
    order: vi.fn(() => Promise.resolve({ data: documents, error: null })),
  };
  const table = { select: vi.fn(() => query) };
  return { from: vi.fn(() => table) };
}

beforeEach(() => {
  authenticateRequestMock.mockReset();
  getFeatureAccessMock.mockReset();
  scopedClientMock.mockReset();
  assertLeadVisibleMock.mockReset();
  authenticateRequestMock.mockResolvedValue(AUTH);
  getFeatureAccessMock.mockReturnValue(true);
});

describe("GET /api/v1/leads/[id]/documents", () => {
  it("401s when unauthenticated", async () => {
    authenticateRequestMock.mockResolvedValue(null);
    const { GET } = await import("./route");
    const res = await GET(fakeReq(), params());
    expect(res.status).toBe(401);
  });

  it("403s when the tenant's industry doesn't have the feature (non-education-consultancy)", async () => {
    getFeatureAccessMock.mockReturnValue(false);
    const { GET } = await import("./route");
    const res = await GET(fakeReq(), params());
    expect(res.status).toBe(403);
  });

  it("404s when the lead isn't visible to this caller", async () => {
    assertLeadVisibleMock.mockResolvedValue(null);
    scopedClientMock.mockResolvedValue(fakeDb([]));
    const { GET } = await import("./route");
    const res = await GET(fakeReq(), params());
    expect(res.status).toBe(404);
  });

  it("groups documents by category when the lead is visible", async () => {
    assertLeadVisibleMock.mockResolvedValue(LEAD);
    const docs = [
      { id: "d1", document_type: "passport", created_at: "2026-01-01" },
      { id: "d2", document_type: "transcript", created_at: "2026-01-02" },
      { id: "d3", document_type: "bank_statement", created_at: "2026-01-03" },
    ];
    scopedClientMock.mockResolvedValue(fakeDb(docs));

    const { GET } = await import("./route");
    const res = await GET(fakeReq(), params());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.documents).toHaveLength(3);
    expect(json.data.by_category.identity).toEqual([docs[0]]);
    expect(json.data.by_category.education).toEqual([docs[1]]);
    expect(json.data.by_category.financial).toEqual([docs[2]]);
  });
});

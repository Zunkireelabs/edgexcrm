import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

const authenticateRequestMock = vi.fn();
const getFeatureAccessMock = vi.fn();
const scopedClientMock = vi.fn();
const assertLeadVisibleMock = vi.fn();
const createAuditLogMock = vi.fn();
const emitEventMock = vi.fn();

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: authenticateRequestMock }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: getFeatureAccessMock }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: scopedClientMock }));
vi.mock("@/lib/documents/access", () => ({ assertLeadVisible: assertLeadVisibleMock }));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: createAuditLogMock, emitEvent: emitEventMock }));

const AUTH = { userId: "user-1", tenantId: "tenant-1", industryId: "education_consultancy" } as unknown as AuthContext;
const LEAD = { id: "lead-1", assigned_to: "user-1", branch_id: null, pipeline_id: "pipe-1", list_id: null };

function fakeReq(): NextRequest {
  return {} as unknown as NextRequest;
}

function params() {
  return { params: Promise.resolve({ id: "lead-1", docId: "doc-1" }) };
}

function fakeDb(document: Record<string, unknown> | null) {
  const docQuery = {
    eq: vi.fn(() => docQuery),
    is: vi.fn(() => docQuery),
    maybeSingle: vi.fn(async () => ({ data: document })),
  };
  const docTable = { select: vi.fn(() => docQuery) };
  const usageTable = { insert: vi.fn(async () => ({ error: null })) };
  return {
    from: vi.fn((table: string) => {
      if (table === "applicant_documents") return docTable;
      if (table === "document_usage_events") return usageTable;
      return {};
    }),
  };
}

beforeEach(() => {
  authenticateRequestMock.mockReset();
  getFeatureAccessMock.mockReset();
  scopedClientMock.mockReset();
  assertLeadVisibleMock.mockReset();
  createAuditLogMock.mockReset();
  emitEventMock.mockReset();

  authenticateRequestMock.mockResolvedValue(AUTH);
  getFeatureAccessMock.mockReturnValue(true);
  assertLeadVisibleMock.mockResolvedValue(LEAD);
  createAuditLogMock.mockResolvedValue(undefined);
  emitEventMock.mockResolvedValue(null);
});

describe("POST /api/v1/leads/[id]/documents/[docId]/complete", () => {
  it("401s when unauthenticated", async () => {
    authenticateRequestMock.mockResolvedValue(null);
    const { POST } = await import("./route");
    const res = await POST(fakeReq(), params());
    expect(res.status).toBe(401);
  });

  it("403s when the tenant's industry doesn't have the feature", async () => {
    getFeatureAccessMock.mockReturnValue(false);
    const { POST } = await import("./route");
    const res = await POST(fakeReq(), params());
    expect(res.status).toBe(403);
  });

  it("404s when the lead isn't visible to this caller", async () => {
    assertLeadVisibleMock.mockResolvedValue(null);
    scopedClientMock.mockResolvedValue(fakeDb(null));
    const { POST } = await import("./route");
    const res = await POST(fakeReq(), params());
    expect(res.status).toBe(404);
  });

  it("404s when the document doesn't exist under this lead", async () => {
    scopedClientMock.mockResolvedValue(fakeDb(null));
    const { POST } = await import("./route");
    const res = await POST(fakeReq(), params());
    expect(res.status).toBe(404);
  });

  it("logs a document.uploaded audit event and a document_usage_events 'upload' row on success", async () => {
    const document = { id: "doc-1", document_type: "passport", lead_id: "lead-1" };
    scopedClientMock.mockResolvedValue(fakeDb(document));

    const { POST } = await import("./route");
    const res = await POST(fakeReq(), params());

    expect(res.status).toBe(200);
    expect(createAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({ action: "document.uploaded", entityId: "doc-1" }));
    expect(emitEventMock).toHaveBeenCalledWith(expect.objectContaining({ type: "document.uploaded", entityId: "doc-1" }));
  });
});

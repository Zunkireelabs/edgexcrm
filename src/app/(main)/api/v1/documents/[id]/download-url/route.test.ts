import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

const authenticateRequestMock = vi.fn();
const getFeatureAccessMock = vi.fn();
const scopedClientMock = vi.fn();
const assertDocumentVisibleMock = vi.fn();
const getDocumentStorageProviderMock = vi.fn();
const createSignedDownloadUrlMock = vi.fn();
const createAuditLogMock = vi.fn();
const emitEventMock = vi.fn();

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: authenticateRequestMock }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: getFeatureAccessMock }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: scopedClientMock }));
vi.mock("@/lib/documents/access", () => ({ assertDocumentVisible: assertDocumentVisibleMock }));
vi.mock("@/lib/documents/storage/r2-provider", () => ({ getDocumentStorageProvider: getDocumentStorageProviderMock }));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: createAuditLogMock, emitEvent: emitEventMock }));

const AUTH = { userId: "user-1", tenantId: "tenant-1", industryId: "education_consultancy" } as unknown as AuthContext;
const LEAD = { id: "lead-1", assigned_to: "user-1", branch_id: null, pipeline_id: "pipe-1", list_id: null };

function fakeReq(): NextRequest {
  return {} as unknown as NextRequest;
}

function params() {
  return { params: Promise.resolve({ id: "doc-1" }) };
}

function fakeDb(version: Record<string, unknown> | null) {
  const versionQuery = { eq: vi.fn(() => versionQuery), maybeSingle: vi.fn(async () => ({ data: version })) };
  const versionTable = { select: vi.fn(() => versionQuery) };
  const usageTable = { insert: vi.fn(async () => ({ error: null })) };
  return {
    from: vi.fn((table: string) => {
      if (table === "applicant_document_versions") return versionTable;
      if (table === "document_usage_events") return usageTable;
      return {};
    }),
  };
}

beforeEach(() => {
  authenticateRequestMock.mockReset();
  getFeatureAccessMock.mockReset();
  scopedClientMock.mockReset();
  assertDocumentVisibleMock.mockReset();
  getDocumentStorageProviderMock.mockReset();
  createSignedDownloadUrlMock.mockReset();
  createAuditLogMock.mockReset();
  emitEventMock.mockReset();

  authenticateRequestMock.mockResolvedValue(AUTH);
  getFeatureAccessMock.mockReturnValue(true);
  getDocumentStorageProviderMock.mockReturnValue({ createSignedDownloadUrl: createSignedDownloadUrlMock });
  createSignedDownloadUrlMock.mockResolvedValue("https://r2.example/signed-get");
  createAuditLogMock.mockResolvedValue(undefined);
  emitEventMock.mockResolvedValue(null);
});

describe("GET /api/v1/documents/[id]/download-url", () => {
  it("401s when unauthenticated", async () => {
    authenticateRequestMock.mockResolvedValue(null);
    const { GET } = await import("./route");
    const res = await GET(fakeReq(), params());
    expect(res.status).toBe(401);
  });

  it("403s when the tenant's industry doesn't have the feature", async () => {
    getFeatureAccessMock.mockReturnValue(false);
    const { GET } = await import("./route");
    const res = await GET(fakeReq(), params());
    expect(res.status).toBe(403);
  });

  it("404s when the document isn't visible", async () => {
    assertDocumentVisibleMock.mockResolvedValue(null);
    scopedClientMock.mockResolvedValue(fakeDb(null));
    const { GET } = await import("./route");
    const res = await GET(fakeReq(), params());
    expect(res.status).toBe(404);
  });

  it("404s when the document has no current_version_id", async () => {
    const document = { id: "doc-1", current_version_id: null };
    assertDocumentVisibleMock.mockResolvedValue({ document, lead: LEAD });
    scopedClientMock.mockResolvedValue(fakeDb(null));
    const { GET } = await import("./route");
    const res = await GET(fakeReq(), params());
    expect(res.status).toBe(404);
  });

  it("returns a 10-minute signed URL and logs document.downloaded + a usage event", async () => {
    const document = { id: "doc-1", current_version_id: "v1" };
    const version = { id: "v1", storage_key: "tenants/tenant-1/.../original.pdf" };
    assertDocumentVisibleMock.mockResolvedValue({ document, lead: LEAD });
    scopedClientMock.mockResolvedValue(fakeDb(version));

    const { GET } = await import("./route");
    const res = await GET(fakeReq(), params());

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.url).toBe("https://r2.example/signed-get");
    expect(json.data.expires_in).toBe(600);
    expect(createSignedDownloadUrlMock).toHaveBeenCalledWith(version.storage_key, 600);
    expect(createAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({ action: "document.downloaded", entityId: "doc-1" }));
  });
});

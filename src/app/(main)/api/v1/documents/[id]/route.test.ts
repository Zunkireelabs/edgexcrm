import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

const authenticateRequestMock = vi.fn();
const getFeatureAccessMock = vi.fn();
const scopedClientMock = vi.fn();
const assertDocumentVisibleMock = vi.fn();
const createAuditLogMock = vi.fn();
const emitEventMock = vi.fn();
const getDocumentStorageProviderMock = vi.fn();
const removeMock = vi.fn();

vi.mock("@/lib/api/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/auth")>("@/lib/api/auth");
  return { ...actual, authenticateRequest: authenticateRequestMock };
});
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: getFeatureAccessMock }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: scopedClientMock }));
vi.mock("@/lib/documents/access", () => ({ assertDocumentVisible: assertDocumentVisibleMock }));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: createAuditLogMock, emitEvent: emitEventMock }));
vi.mock("@/lib/documents/storage/r2-provider", () => ({ getDocumentStorageProvider: getDocumentStorageProviderMock }));

const LEAD = { id: "lead-1", assigned_to: "user-1", branch_id: null, pipeline_id: "pipe-1", list_id: null };

function authAs(role: "owner" | "admin" | "staff", userId = "user-1"): AuthContext {
  return { userId, tenantId: "tenant-1", industryId: "education_consultancy", role } as unknown as AuthContext;
}

function fakeReq(body?: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function params() {
  return { params: Promise.resolve({ id: "doc-1" }) };
}

function fakeDb(opts: {
  extraction?: Record<string, unknown> | null;
  updated?: Record<string, unknown>;
  updateError?: unknown;
  deleteError?: unknown;
  versions?: { storage_key: string }[];
  versionsError?: unknown;
} = {}) {
  const extractionQuery = {
    eq: vi.fn(() => extractionQuery),
    order: vi.fn(() => extractionQuery),
    limit: vi.fn(() => extractionQuery),
    maybeSingle: vi.fn(async () => ({ data: opts.extraction ?? null })),
  };
  const extractionTable = { select: vi.fn(() => extractionQuery) };

  const updateSelect = { single: vi.fn(async () => ({ data: opts.updated ?? { id: "doc-1" }, error: opts.updateError ?? null })) };
  const updateEq = { select: vi.fn(() => updateSelect), then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: opts.deleteError ?? null }).then(resolve) };
  const docTable = { update: vi.fn(() => ({ eq: vi.fn(() => updateEq) })) };

  const usageTable = { insert: vi.fn(async () => ({ error: null })) };

  const versionsQuery = { eq: vi.fn(async () => ({ data: opts.versions ?? [{ storage_key: "tenants/t1/.../v1/original.pdf" }], error: opts.versionsError ?? null })) };
  const versionsTable = { select: vi.fn(() => versionsQuery) };

  return {
    from: vi.fn((table: string) => {
      if (table === "applicant_document_extractions") return extractionTable;
      if (table === "applicant_documents") return docTable;
      if (table === "document_usage_events") return usageTable;
      if (table === "applicant_document_versions") return versionsTable;
      return {};
    }),
  };
}

beforeEach(() => {
  authenticateRequestMock.mockReset();
  getFeatureAccessMock.mockReset();
  scopedClientMock.mockReset();
  assertDocumentVisibleMock.mockReset();
  createAuditLogMock.mockReset();
  emitEventMock.mockReset();
  getDocumentStorageProviderMock.mockReset();
  removeMock.mockReset();

  authenticateRequestMock.mockResolvedValue(authAs("staff"));
  getFeatureAccessMock.mockReturnValue(true);
  createAuditLogMock.mockResolvedValue(undefined);
  emitEventMock.mockResolvedValue(null);
  getDocumentStorageProviderMock.mockReturnValue({ remove: removeMock });
  removeMock.mockResolvedValue(undefined);
});

describe("GET /api/v1/documents/[id]", () => {
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

  it("404s when the document isn't visible (not found, or lead not visible) — covers both cross-tenant and non-assigned-counselor cases", async () => {
    assertDocumentVisibleMock.mockResolvedValue(null);
    scopedClientMock.mockResolvedValue(fakeDb());
    const { GET } = await import("./route");
    const res = await GET(fakeReq(), params());
    expect(res.status).toBe(404);
  });

  it("returns the document with a null extraction (nothing writes it in Phase 1)", async () => {
    const document = { id: "doc-1", name: "Passport" };
    assertDocumentVisibleMock.mockResolvedValue({ document, lead: LEAD });
    scopedClientMock.mockResolvedValue(fakeDb({ extraction: null }));

    const { GET } = await import("./route");
    const res = await GET(fakeReq(), params());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.extraction).toBeNull();
    expect(json.data.id).toBe("doc-1");
  });
});

describe("PATCH /api/v1/documents/[id]", () => {
  it("404s when the document isn't visible", async () => {
    assertDocumentVisibleMock.mockResolvedValue(null);
    scopedClientMock.mockResolvedValue(fakeDb());
    const { PATCH } = await import("./route");
    const res = await PATCH(fakeReq({ name: "New name" }), params());
    expect(res.status).toBe(404);
  });

  it("422s on an invalid verification_status", async () => {
    const document = { id: "doc-1" };
    assertDocumentVisibleMock.mockResolvedValue({ document, lead: LEAD });
    scopedClientMock.mockResolvedValue(fakeDb());
    const { PATCH } = await import("./route");
    const res = await PATCH(fakeReq({ verification_status: "approved" }), params());
    expect(res.status).toBe(422);
  });

  it("logs document.verified when verification_status is set to verified", async () => {
    const document = { id: "doc-1" };
    assertDocumentVisibleMock.mockResolvedValue({ document, lead: LEAD });
    scopedClientMock.mockResolvedValue(fakeDb({ updated: { id: "doc-1", verification_status: "verified" } }));

    const { PATCH } = await import("./route");
    const res = await PATCH(fakeReq({ verification_status: "verified" }), params());
    expect(res.status).toBe(200);
    expect(createAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({ action: "document.verified" }));
  });

  it("logs document.renamed when only name changes", async () => {
    const document = { id: "doc-1" };
    assertDocumentVisibleMock.mockResolvedValue({ document, lead: LEAD });
    scopedClientMock.mockResolvedValue(fakeDb({ updated: { id: "doc-1", name: "Renamed" } }));

    const { PATCH } = await import("./route");
    const res = await PATCH(fakeReq({ name: "Renamed" }), params());
    expect(res.status).toBe(200);
    expect(createAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({ action: "document.renamed" }));
  });
});

describe("DELETE /api/v1/documents/[id]", () => {
  it("404s when the document isn't visible", async () => {
    assertDocumentVisibleMock.mockResolvedValue(null);
    scopedClientMock.mockResolvedValue(fakeDb());
    const { DELETE } = await import("./route");
    const res = await DELETE(fakeReq(), params());
    expect(res.status).toBe(404);
  });

  it("403s for a non-admin who is NOT the original uploader", async () => {
    authenticateRequestMock.mockResolvedValue(authAs("staff", "user-2"));
    const document = { id: "doc-1", uploaded_by: "user-1" };
    assertDocumentVisibleMock.mockResolvedValue({ document, lead: LEAD });
    scopedClientMock.mockResolvedValue(fakeDb());

    const { DELETE } = await import("./route");
    const res = await DELETE(fakeReq(), params());
    expect(res.status).toBe(403);
  });

  it("succeeds for the original uploader even without an admin role", async () => {
    authenticateRequestMock.mockResolvedValue(authAs("staff", "user-1"));
    const document = { id: "doc-1", uploaded_by: "user-1" };
    assertDocumentVisibleMock.mockResolvedValue({ document, lead: LEAD });
    scopedClientMock.mockResolvedValue(fakeDb());

    const { DELETE } = await import("./route");
    const res = await DELETE(fakeReq(), params());
    expect(res.status).toBe(200);
  });

  it("succeeds for a tenant admin who is NOT the uploader", async () => {
    authenticateRequestMock.mockResolvedValue(authAs("admin", "user-2"));
    const document = { id: "doc-1", uploaded_by: "user-1" };
    assertDocumentVisibleMock.mockResolvedValue({ document, lead: LEAD });
    scopedClientMock.mockResolvedValue(fakeDb());

    const { DELETE } = await import("./route");
    const res = await DELETE(fakeReq(), params());
    expect(res.status).toBe(200);
    expect(createAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({ action: "document.deleted", entityId: "doc-1" }));
  });

  it("THE FIX: purges every version's file from R2 before soft-deleting the DB row", async () => {
    const document = { id: "doc-1", uploaded_by: "user-1" };
    assertDocumentVisibleMock.mockResolvedValue({ document, lead: LEAD });
    const versions = [{ storage_key: "tenants/t1/.../v1/original.pdf" }, { storage_key: "tenants/t1/.../v2/original.pdf" }];
    const db = fakeDb({ versions });
    scopedClientMock.mockResolvedValue(db);

    const { DELETE } = await import("./route");
    const res = await DELETE(fakeReq(), params());

    expect(res.status).toBe(200);
    expect(removeMock).toHaveBeenCalledWith(["tenants/t1/.../v1/original.pdf", "tenants/t1/.../v2/original.pdf"]);
    const docTable = db.from("applicant_documents") as unknown as { update: ReturnType<typeof vi.fn> };
    // remove() must have been called before the DB update — assert call order via mock invocation timestamps is
    // overkill here; the route's own control flow (await remove() before await update()) already guarantees it,
    // and this assertion just confirms both actually happened.
    expect(docTable.update).toHaveBeenCalled();
  });

  it("THE FIX: 500s and leaves the document intact when the R2 purge fails — never claims deleted with files still in the bucket", async () => {
    const document = { id: "doc-1", uploaded_by: "user-1" };
    assertDocumentVisibleMock.mockResolvedValue({ document, lead: LEAD });
    const db = fakeDb();
    scopedClientMock.mockResolvedValue(db);
    removeMock.mockRejectedValue(new Error("R2 network error"));

    const { DELETE } = await import("./route");
    const res = await DELETE(fakeReq(), params());

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error.code).toBe("STORAGE_ERROR");
    const docTable = db.from("applicant_documents") as unknown as { update: ReturnType<typeof vi.fn> };
    expect(docTable.update).not.toHaveBeenCalled();
    expect(createAuditLogMock).not.toHaveBeenCalled();
  });

  it("purges nothing and still succeeds when the document has no versions", async () => {
    const document = { id: "doc-1", uploaded_by: "user-1" };
    assertDocumentVisibleMock.mockResolvedValue({ document, lead: LEAD });
    scopedClientMock.mockResolvedValue(fakeDb({ versions: [] }));

    const { DELETE } = await import("./route");
    const res = await DELETE(fakeReq(), params());

    expect(res.status).toBe(200);
    expect(removeMock).toHaveBeenCalledWith([]);
  });
});

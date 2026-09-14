import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

const authenticateRequestMock = vi.fn();
const getFeatureAccessMock = vi.fn();
const scopedClientMock = vi.fn();
const assertLeadVisibleMock = vi.fn();
const getDocumentStorageProviderMock = vi.fn();
const existsMock = vi.fn();
const createAuditLogMock = vi.fn();
const emitEventMock = vi.fn();
const isIngestionEnabledForTenantMock = vi.fn();
const sendMock = vi.fn();

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: authenticateRequestMock }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: getFeatureAccessMock }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: scopedClientMock }));
vi.mock("@/lib/documents/access", () => ({ assertLeadVisible: assertLeadVisibleMock }));
vi.mock("@/lib/documents/storage/r2-provider", () => ({ getDocumentStorageProvider: getDocumentStorageProviderMock }));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: createAuditLogMock, emitEvent: emitEventMock }));
vi.mock("@/lib/ai/flag", () => ({ isIngestionEnabledForTenant: isIngestionEnabledForTenantMock }));
vi.mock("@/lib/inngest/client", () => ({ inngest: { send: sendMock } }));

const AUTH = { userId: "user-1", tenantId: "tenant-1", industryId: "education_consultancy" } as unknown as AuthContext;
const LEAD = { id: "lead-1", assigned_to: "user-1", branch_id: null, pipeline_id: "pipe-1", list_id: null };
const VALID_CHECKSUM = "a".repeat(64);

function fakeReq(body?: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function params() {
  return { params: Promise.resolve({ id: "lead-1", docId: "doc-1" }) };
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    version_id: "22222222-2222-2222-2222-222222222222",
    document_type: "passport",
    name: "My Passport",
    original_filename: "passport.pdf",
    mime_type: "application/pdf",
    file_size: 1024,
    checksum: VALID_CHECKSUM,
    ...overrides,
  };
}

function fakeDb(opts: {
  existingDoc?: Record<string, unknown> | null;
  settings?: Record<string, unknown> | null;
  createdDoc?: Record<string, unknown>;
  updatedDoc?: Record<string, unknown>;
} = {}) {
  const existingQuery = {
    eq: vi.fn(() => existingQuery),
    is: vi.fn(() => existingQuery),
    maybeSingle: vi.fn(async () => ({ data: opts.existingDoc ?? null })),
  };
  const settingsQuery = { maybeSingle: vi.fn(async () => ({ data: opts.settings ?? null })) };
  const insertSelect = { single: vi.fn(async () => ({ data: opts.createdDoc ?? { id: "doc-1", document_type: "passport" }, error: null })) };
  const updateSelect = { single: vi.fn(async () => ({ data: opts.updatedDoc ?? opts.createdDoc ?? { id: "doc-1" }, error: null })) };
  const docTable = {
    select: vi.fn(() => existingQuery),
    insert: vi.fn(() => ({ select: vi.fn(() => insertSelect) })),
    update: vi.fn(() => ({ eq: vi.fn(() => ({ select: vi.fn(() => updateSelect) })) })),
  };
  const versionTable = { insert: vi.fn(async () => ({ error: null })) };
  const usageTable = { insert: vi.fn(async () => ({ error: null })) };
  const settingsTable = { select: vi.fn(() => settingsQuery) };

  return {
    from: vi.fn((table: string) => {
      if (table === "applicant_documents") return docTable;
      if (table === "applicant_document_versions") return versionTable;
      if (table === "document_usage_events") return usageTable;
      if (table === "tenant_document_settings") return settingsTable;
      return {};
    }),
  };
}

beforeEach(() => {
  authenticateRequestMock.mockReset();
  getFeatureAccessMock.mockReset();
  scopedClientMock.mockReset();
  assertLeadVisibleMock.mockReset();
  getDocumentStorageProviderMock.mockReset();
  existsMock.mockReset();
  createAuditLogMock.mockReset();
  emitEventMock.mockReset();
  isIngestionEnabledForTenantMock.mockReset();
  sendMock.mockReset();

  authenticateRequestMock.mockResolvedValue(AUTH);
  getFeatureAccessMock.mockReturnValue(true);
  assertLeadVisibleMock.mockResolvedValue(LEAD);
  getDocumentStorageProviderMock.mockReturnValue({ exists: existsMock });
  existsMock.mockResolvedValue(true);
  createAuditLogMock.mockResolvedValue(undefined);
  emitEventMock.mockResolvedValue(null);
  isIngestionEnabledForTenantMock.mockResolvedValue(false);
  sendMock.mockResolvedValue(undefined);
  scopedClientMock.mockResolvedValue(fakeDb());
});

describe("POST /api/v1/leads/[id]/documents/[docId]/complete", () => {
  it("401s when unauthenticated", async () => {
    authenticateRequestMock.mockResolvedValue(null);
    const { POST } = await import("./route");
    const res = await POST(fakeReq(validBody()), params());
    expect(res.status).toBe(401);
  });

  it("403s when the tenant's industry doesn't have the feature", async () => {
    getFeatureAccessMock.mockReturnValue(false);
    const { POST } = await import("./route");
    const res = await POST(fakeReq(validBody()), params());
    expect(res.status).toBe(403);
  });

  it("404s when the lead isn't visible to this caller", async () => {
    assertLeadVisibleMock.mockResolvedValue(null);
    const { POST } = await import("./route");
    const res = await POST(fakeReq(validBody()), params());
    expect(res.status).toBe(404);
  });

  it("THE FIX: 409s and writes NOTHING to the database when the file was never actually uploaded to R2", async () => {
    existsMock.mockResolvedValue(false);
    const db = fakeDb();
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST(fakeReq(validBody()), params());

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error.code).toBe("UPLOAD_INCOMPLETE");
    // The bug this route exists to prevent: a ghost row claiming "uploaded"
    // with nothing behind it in storage. Assert the insert was never called.
    const docTable = db.from("applicant_documents") as unknown as { insert: ReturnType<typeof vi.fn> };
    expect(docTable.insert).not.toHaveBeenCalled();
    const versionTable = db.from("applicant_document_versions") as unknown as { insert: ReturnType<typeof vi.fn> };
    expect(versionTable.insert).not.toHaveBeenCalled();
    expect(createAuditLogMock).not.toHaveBeenCalled();
  });

  it("checks existence at the exact storage key derived from the request, not a guessed one", async () => {
    scopedClientMock.mockResolvedValue(fakeDb());
    const { POST } = await import("./route");
    await POST(fakeReq(validBody()), params());

    expect(existsMock).toHaveBeenCalledTimes(1);
    const [key] = existsMock.mock.calls[0];
    expect(key).toBe("tenants/tenant-1/applicants/lead-1/documents/doc-1/versions/22222222-2222-2222-2222-222222222222/original.pdf");
  });

  it("creates the document + version-1 rows ONLY after confirming the file exists, and logs document.uploaded", async () => {
    const createdDoc = { id: "doc-1", document_type: "passport" };
    const db = fakeDb({ createdDoc, updatedDoc: { ...createdDoc, current_version_id: "22222222-2222-2222-2222-222222222222" } });
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST(fakeReq(validBody()), params());

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.current_version_id).toBe("22222222-2222-2222-2222-222222222222");
    expect(createAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({ action: "document.uploaded", entityId: "doc-1" }));
  });

  it("422s with a {count,max} body when file_size exceeds the tenant's configured cap", async () => {
    scopedClientMock.mockResolvedValue(fakeDb({ settings: { max_document_size_mb: 1 } }));
    const { POST } = await import("./route");
    const res = await POST(fakeReq(validBody({ file_size: 2 * 1024 * 1024 })), params());
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error.code).toBe("FILE_TOO_LARGE");
  });

  it("is idempotent — a second call after a real success returns the existing document without re-checking storage", async () => {
    const existingDoc = { id: "doc-1", status: "uploaded" };
    scopedClientMock.mockResolvedValue(fakeDb({ existingDoc }));

    const { POST } = await import("./route");
    const res = await POST(fakeReq(validBody()), params());

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual(existingDoc);
    expect(existsMock).not.toHaveBeenCalled();
  });

  it("500s with STORAGE_ERROR (not treated as missing) when the existence check itself fails", async () => {
    existsMock.mockRejectedValue(new Error("network timeout"));
    scopedClientMock.mockResolvedValue(fakeDb());

    const { POST } = await import("./route");
    const res = await POST(fakeReq(validBody()), params());

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error.code).toBe("STORAGE_ERROR");
  });

  describe("Phase 3 ingestion trigger", () => {
    it("does not send an ingest event when the tenant lacks the consent gate", async () => {
      isIngestionEnabledForTenantMock.mockResolvedValue(false);
      const createdDoc = { id: "doc-1", document_type: "passport" };
      scopedClientMock.mockResolvedValue(fakeDb({ createdDoc, updatedDoc: createdDoc }));

      const { POST } = await import("./route");
      const res = await POST(fakeReq(validBody()), params());

      expect(res.status).toBe(201);
      expect(isIngestionEnabledForTenantMock).toHaveBeenCalledWith("tenant-1");
      expect(sendMock).not.toHaveBeenCalled();
    });

    it("sends an ingest event with the right ids when the tenant has the consent gate", async () => {
      isIngestionEnabledForTenantMock.mockResolvedValue(true);
      const createdDoc = { id: "doc-1", document_type: "passport" };
      scopedClientMock.mockResolvedValue(fakeDb({ createdDoc, updatedDoc: createdDoc }));

      const { POST } = await import("./route");
      const res = await POST(fakeReq(validBody()), params());

      expect(res.status).toBe(201);
      expect(sendMock).toHaveBeenCalledWith({
        name: "applicant-documents/document.ingest.requested",
        data: {
          tenantId: "tenant-1",
          leadId: "lead-1",
          documentId: "doc-1",
          versionId: "22222222-2222-2222-2222-222222222222",
        },
      });
    });

    it("does not send an ingest event on the idempotent (already-confirmed) path", async () => {
      isIngestionEnabledForTenantMock.mockResolvedValue(true);
      const existingDoc = { id: "doc-1", status: "uploaded" };
      scopedClientMock.mockResolvedValue(fakeDb({ existingDoc }));

      const { POST } = await import("./route");
      const res = await POST(fakeReq(validBody()), params());

      expect(res.status).toBe(200);
      expect(sendMock).not.toHaveBeenCalled();
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

const authenticateRequestMock = vi.fn();
const getFeatureAccessMock = vi.fn();
const scopedClientMock = vi.fn();
const assertDocumentVisibleMock = vi.fn();
const getDocumentStorageProviderMock = vi.fn();
const existsMock = vi.fn();
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
const DOCUMENT = { id: "doc-1", lead_id: "lead-1", current_version_id: "v1" };
const VALID_CHECKSUM = "c".repeat(64);
const NEW_VERSION_ID = "33333333-3333-3333-3333-333333333333";

function fakeReq(body?: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function params() {
  return { params: Promise.resolve({ id: "doc-1", versionId: NEW_VERSION_ID }) };
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    original_filename: "transcript-v2.pdf",
    mime_type: "application/pdf",
    file_size: 2048,
    checksum: VALID_CHECKSUM,
    ...overrides,
  };
}

function fakeDb(opts: {
  existingVersion?: Record<string, unknown> | null;
  currentDoc?: Record<string, unknown> | null;
  settings?: Record<string, unknown> | null;
  maxVersion?: { version_number: number } | null;
  createdVersion?: Record<string, unknown>;
  updatedDoc?: Record<string, unknown>;
} = {}) {
  const existingVersionQuery = { eq: vi.fn(() => existingVersionQuery), maybeSingle: vi.fn(async () => ({ data: opts.existingVersion ?? null })) };
  const maxQuery = {
    eq: vi.fn(() => maxQuery),
    order: vi.fn(() => maxQuery),
    limit: vi.fn(() => maxQuery),
    maybeSingle: vi.fn(async () => ({ data: opts.maxVersion ?? null })),
  };
  const insertSelect = { single: vi.fn(async () => ({ data: opts.createdVersion ?? { id: NEW_VERSION_ID, version_number: 2 }, error: null })) };
  const versionTable = {
    select: vi.fn((columns?: string) => (columns === "version_number" ? maxQuery : existingVersionQuery)),
    insert: vi.fn(() => ({ select: vi.fn(() => insertSelect) })),
  };

  const currentDocQuery = { eq: vi.fn(() => currentDocQuery), maybeSingle: vi.fn(async () => ({ data: opts.currentDoc ?? DOCUMENT })) };
  const updateSelect = { single: vi.fn(async () => ({ data: opts.updatedDoc ?? { id: "doc-1", current_version_id: NEW_VERSION_ID }, error: null })) };
  const docTable = {
    select: vi.fn(() => currentDocQuery),
    update: vi.fn(() => ({ eq: vi.fn(() => ({ select: vi.fn(() => updateSelect) })) })),
  };

  const usageTable = { insert: vi.fn(async () => ({ error: null })) };
  const settingsQuery = { maybeSingle: vi.fn(async () => ({ data: opts.settings ?? null })) };
  const settingsTable = { select: vi.fn(() => settingsQuery) };

  return {
    from: vi.fn((table: string) => {
      if (table === "applicant_document_versions") return versionTable;
      if (table === "applicant_documents") return docTable;
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
  assertDocumentVisibleMock.mockReset();
  getDocumentStorageProviderMock.mockReset();
  existsMock.mockReset();
  createAuditLogMock.mockReset();
  emitEventMock.mockReset();

  authenticateRequestMock.mockResolvedValue(AUTH);
  getFeatureAccessMock.mockReturnValue(true);
  assertDocumentVisibleMock.mockResolvedValue({ document: DOCUMENT, lead: LEAD });
  getDocumentStorageProviderMock.mockReturnValue({ exists: existsMock });
  existsMock.mockResolvedValue(true);
  createAuditLogMock.mockResolvedValue(undefined);
  emitEventMock.mockResolvedValue(null);
  scopedClientMock.mockResolvedValue(fakeDb());
});

describe("POST /api/v1/documents/[id]/versions/[versionId]/complete", () => {
  it("401s when unauthenticated", async () => {
    authenticateRequestMock.mockResolvedValue(null);
    const { POST } = await import("./route");
    const res = await POST(fakeReq(validBody()), params());
    expect(res.status).toBe(401);
  });

  it("404s when the document isn't visible", async () => {
    assertDocumentVisibleMock.mockResolvedValue(null);
    const { POST } = await import("./route");
    const res = await POST(fakeReq(validBody()), params());
    expect(res.status).toBe(404);
  });

  it("THE FIX: 409s and leaves current_version_id untouched when the file was never actually uploaded", async () => {
    existsMock.mockResolvedValue(false);
    const db = fakeDb();
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST(fakeReq(validBody()), params());

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error.code).toBe("UPLOAD_INCOMPLETE");
    // The dangerous case this route exists to prevent: repointing a
    // PREVIOUSLY WORKING document's current_version_id at a file that was
    // never actually written, breaking access to something that worked before.
    const versionTable = db.from("applicant_document_versions") as unknown as { insert: ReturnType<typeof vi.fn> };
    expect(versionTable.insert).not.toHaveBeenCalled();
    const docTable = db.from("applicant_documents") as unknown as { update: ReturnType<typeof vi.fn> };
    expect(docTable.update).not.toHaveBeenCalled();
  });

  it("re-points current_version_id and creates the version row ONLY after confirming the file exists", async () => {
    const db = fakeDb({ updatedDoc: { id: "doc-1", current_version_id: NEW_VERSION_ID } });
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST(fakeReq(validBody()), params());

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.document.current_version_id).toBe(NEW_VERSION_ID);
    expect(createAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({ action: "document.version_created", entityId: "doc-1" }));
  });

  it("is idempotent — a second call after a real success returns the current document without re-checking storage", async () => {
    const existingVersion = { id: NEW_VERSION_ID, version_number: 2 };
    scopedClientMock.mockResolvedValue(fakeDb({ existingVersion }));

    const { POST } = await import("./route");
    const res = await POST(fakeReq(validBody()), params());

    expect(res.status).toBe(200);
    expect(existsMock).not.toHaveBeenCalled();
  });

  it("422s with a {count,max} body when file_size exceeds the tenant's configured cap", async () => {
    scopedClientMock.mockResolvedValue(fakeDb({ settings: { max_document_size_mb: 1 } }));
    const { POST } = await import("./route");
    const res = await POST(fakeReq(validBody({ file_size: 2 * 1024 * 1024 })), params());
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error.code).toBe("FILE_TOO_LARGE");
  });
});

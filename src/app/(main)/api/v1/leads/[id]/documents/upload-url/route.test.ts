import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

const authenticateRequestMock = vi.fn();
const getFeatureAccessMock = vi.fn();
const scopedClientMock = vi.fn();
const assertLeadVisibleMock = vi.fn();
const getDocumentStorageProviderMock = vi.fn();
const createSignedUploadUrlMock = vi.fn();

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: authenticateRequestMock }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: getFeatureAccessMock }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: scopedClientMock }));
vi.mock("@/lib/documents/access", () => ({ assertLeadVisible: assertLeadVisibleMock }));
vi.mock("@/lib/documents/storage/r2-provider", () => ({ getDocumentStorageProvider: getDocumentStorageProviderMock }));

const AUTH = { userId: "user-1", tenantId: "tenant-1", industryId: "education_consultancy" } as unknown as AuthContext;
const LEAD = { id: "lead-1", assigned_to: "user-1", branch_id: null, pipeline_id: "pipe-1", list_id: null };
const VALID_CHECKSUM = "a".repeat(64);

function fakeReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function params() {
  return { params: Promise.resolve({ id: "lead-1" }) };
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    document_type: "passport",
    name: "My Passport",
    original_filename: "passport.pdf",
    mime_type: "application/pdf",
    file_size: 1024,
    checksum: VALID_CHECKSUM,
    ...overrides,
  };
}

function fakeDb(opts: { settings?: Record<string, unknown> | null; createdDoc?: Record<string, unknown>; updatedDoc?: Record<string, unknown> } = {}) {
  const settingsQuery = { maybeSingle: vi.fn(async () => ({ data: opts.settings ?? null })) };
  const settingsTable = { select: vi.fn(() => settingsQuery) };

  const docInsertSelect = { single: vi.fn(async () => ({ data: opts.createdDoc ?? { id: "doc-1" }, error: null })) };
  const docInsert = { select: vi.fn(() => docInsertSelect) };
  const docUpdateEq = { select: vi.fn(() => ({ single: vi.fn(async () => ({ data: opts.updatedDoc ?? opts.createdDoc ?? { id: "doc-1" }, error: null })) })) };
  const docTable = { insert: vi.fn(() => docInsert), update: vi.fn(() => ({ eq: vi.fn(() => docUpdateEq) })) };

  const versionInsert = { error: null };
  const versionTable = { insert: vi.fn(async () => versionInsert) };

  return {
    from: vi.fn((table: string) => {
      if (table === "tenant_document_settings") return settingsTable;
      if (table === "applicant_documents") return docTable;
      if (table === "applicant_document_versions") return versionTable;
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
  createSignedUploadUrlMock.mockReset();

  authenticateRequestMock.mockResolvedValue(AUTH);
  getFeatureAccessMock.mockReturnValue(true);
  assertLeadVisibleMock.mockResolvedValue(LEAD);
  getDocumentStorageProviderMock.mockReturnValue({ createSignedUploadUrl: createSignedUploadUrlMock });
  createSignedUploadUrlMock.mockResolvedValue({ url: "https://r2.example/signed-put", headers: { "Content-Type": "application/pdf" } });
});

describe("POST /api/v1/leads/[id]/documents/upload-url", () => {
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
    scopedClientMock.mockResolvedValue(fakeDb());
    const { POST } = await import("./route");
    const res = await POST(fakeReq(validBody()), params());
    expect(res.status).toBe(404);
  });

  it("422s on an unsupported mime type", async () => {
    scopedClientMock.mockResolvedValue(fakeDb());
    const { POST } = await import("./route");
    const res = await POST(fakeReq(validBody({ mime_type: "application/x-msdownload", original_filename: "virus.exe" })), params());
    expect(res.status).toBe(422);
  });

  it("falls back to the extension when the browser reports an empty mime type", async () => {
    scopedClientMock.mockResolvedValue(fakeDb());
    const { POST } = await import("./route");
    const res = await POST(fakeReq(validBody({ mime_type: "", original_filename: "transcript.pdf" })), params());
    expect(res.status).toBe(201);
  });

  it("422s with a {count,max} body when file_size exceeds the tenant's configured cap", async () => {
    scopedClientMock.mockResolvedValue(fakeDb({ settings: { max_document_size_mb: 1 } }));
    const { POST } = await import("./route");
    const res = await POST(fakeReq(validBody({ file_size: 2 * 1024 * 1024 })), params());
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error.code).toBe("FILE_TOO_LARGE");
    expect(json.error.details).toEqual({ count: 2 * 1024 * 1024, max: 1024 * 1024 });
  });

  it("falls back to the 25MB default when no tenant_document_settings row exists", async () => {
    scopedClientMock.mockResolvedValue(fakeDb({ settings: null }));
    const { POST } = await import("./route");
    const res = await POST(fakeReq(validBody({ file_size: 26 * 1024 * 1024 })), params());
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error.details.max).toBe(25 * 1024 * 1024);
  });

  it("422s when checksum isn't a valid sha256 hex digest", async () => {
    scopedClientMock.mockResolvedValue(fakeDb());
    const { POST } = await import("./route");
    const res = await POST(fakeReq(validBody({ checksum: "not-a-hash" })), params());
    expect(res.status).toBe(422);
  });

  it("creates the document + version-1 rows and returns a signed upload URL on success", async () => {
    const createdDoc = { id: "doc-1", status: "uploaded" };
    const db = fakeDb({ createdDoc, updatedDoc: { ...createdDoc, current_version_id: "some-version" } });
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST(fakeReq(validBody()), params());

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.upload_url).toBe("https://r2.example/signed-put");
    expect(json.data.document.current_version_id).toBe("some-version");
    expect(createSignedUploadUrlMock).toHaveBeenCalledTimes(1);
    const [key, contentType] = createSignedUploadUrlMock.mock.calls[0];
    expect(key).toMatch(/^tenants\/tenant-1\/applicants\/lead-1\/documents\/.+\/versions\/.+\/original\.pdf$/);
    expect(contentType).toBe("application/pdf");
  });
});

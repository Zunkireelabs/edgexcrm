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
    ...overrides,
  };
}

function fakeDb(
  opts: {
    settings?: Record<string, unknown> | null;
    /** applicant_documents rows counted for the per-lead cap query */
    leadDocs?: Record<string, unknown>[];
    /** applicant_documents rows used to seed the storage-quota's live-doc-id lookup */
    tenantDocs?: Record<string, unknown>[];
    /** applicant_document_versions rows summed for the storage-quota check */
    versions?: Record<string, unknown>[];
  } = {},
) {
  const settingsQuery = { maybeSingle: vi.fn(async () => ({ data: opts.settings ?? null })) };
  const settingsTable = { select: vi.fn(() => settingsQuery) };

  const docsTable = {
    select: vi.fn((_cols: string, selectOpts?: { count?: string; head?: boolean }) => {
      if (selectOpts?.head) {
        // getLeadDocumentCount's count:exact/head:true query
        const c: Record<string, unknown> = {};
        c.eq = () => c;
        c.is = async () => ({ count: (opts.leadDocs ?? []).length, error: null });
        return c;
      }
      // getTenantStorageUsedBytes's plain "id" select for live documents
      const c: Record<string, unknown> = {};
      c.is = () => Promise.resolve({ data: opts.tenantDocs ?? [], error: null });
      return c;
    }),
  };

  const versionsTable = {
    select: vi.fn(() => {
      const c: Record<string, unknown> = {};
      c.in = () => Promise.resolve({ data: opts.versions ?? [], error: null });
      return c;
    }),
  };

  return {
    from: vi.fn((table: string) => {
      if (table === "tenant_document_settings") return settingsTable;
      if (table === "applicant_documents") return docsTable;
      if (table === "applicant_document_versions") return versionsTable;
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
  scopedClientMock.mockResolvedValue(fakeDb());
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
    const { POST } = await import("./route");
    const res = await POST(fakeReq(validBody()), params());
    expect(res.status).toBe(404);
  });

  it("422s on an unsupported mime type", async () => {
    const { POST } = await import("./route");
    const res = await POST(fakeReq(validBody({ mime_type: "application/x-msdownload", original_filename: "virus.exe" })), params());
    expect(res.status).toBe(422);
  });

  it("falls back to the extension when the browser reports an empty mime type", async () => {
    const { POST } = await import("./route");
    const res = await POST(fakeReq(validBody({ mime_type: "", original_filename: "transcript.pdf" })), params());
    expect(res.status).toBe(200);
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

  it("422s with DOCUMENT_LIMIT_EXCEEDED when the lead is already at the per-lead document cap", async () => {
    scopedClientMock.mockResolvedValue(
      fakeDb({ settings: { max_documents_per_lead: 2 }, leadDocs: [{ id: "d1" }, { id: "d2" }] }),
    );
    const { POST } = await import("./route");
    const res = await POST(fakeReq(validBody()), params());
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error.code).toBe("DOCUMENT_LIMIT_EXCEEDED");
    expect(json.error.details).toEqual({ count: 2, max: 2 });
  });

  it("allows the upload when the lead is under the per-lead document cap", async () => {
    scopedClientMock.mockResolvedValue(fakeDb({ settings: { max_documents_per_lead: 5 }, leadDocs: [{ id: "d1" }] }));
    const { POST } = await import("./route");
    const res = await POST(fakeReq(validBody()), params());
    expect(res.status).toBe(200);
  });

  it("skips the per-lead cap entirely when max_documents_per_lead is null (unlimited)", async () => {
    const db = fakeDb({ settings: { max_documents_per_lead: null } });
    scopedClientMock.mockResolvedValue(db);
    const { POST } = await import("./route");
    const res = await POST(fakeReq(validBody()), params());
    expect(res.status).toBe(200);
    expect(db.from).not.toHaveBeenCalledWith("applicant_documents");
  });

  it("422s with STORAGE_QUOTA_EXCEEDED when this upload would push the tenant over its storage quota", async () => {
    scopedClientMock.mockResolvedValue(
      fakeDb({
        settings: { max_storage_bytes: 5000 },
        tenantDocs: [{ id: "d1" }],
        versions: [{ file_size: 4500 }],
      }),
    );
    const { POST } = await import("./route");
    // 4500 already used + 1024 (validBody's file_size) > 5000 cap
    const res = await POST(fakeReq(validBody({ file_size: 1024 })), params());
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error.code).toBe("STORAGE_QUOTA_EXCEEDED");
    expect(json.error.details).toEqual({ count: 5524, max: 5000 });
  });

  it("allows the upload when it fits within the storage quota", async () => {
    scopedClientMock.mockResolvedValue(
      fakeDb({ settings: { max_storage_bytes: 10_000 }, tenantDocs: [{ id: "d1" }], versions: [{ file_size: 1000 }] }),
    );
    const { POST } = await import("./route");
    const res = await POST(fakeReq(validBody({ file_size: 1024 })), params());
    expect(res.status).toBe(200);
  });

  it("skips the storage quota entirely when max_storage_bytes is null (unlimited)", async () => {
    const db = fakeDb({ settings: { max_storage_bytes: null } });
    scopedClientMock.mockResolvedValue(db);
    const { POST } = await import("./route");
    const res = await POST(fakeReq(validBody()), params());
    expect(res.status).toBe(200);
    expect(db.from).not.toHaveBeenCalledWith("applicant_document_versions");
  });

  it("writes nothing to the database — only issues a signed upload URL + ids", async () => {
    const db = fakeDb();
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST(fakeReq(validBody()), params());

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.upload_url).toBe("https://r2.example/signed-put");
    expect(typeof json.data.document_id).toBe("string");
    expect(typeof json.data.version_id).toBe("string");
    // The only table this route ever touches is tenant_document_settings
    // (to read the size cap) — never applicant_documents/versions.
    expect(db.from).not.toHaveBeenCalledWith("applicant_documents");
    expect(db.from).not.toHaveBeenCalledWith("applicant_document_versions");
    expect(createSignedUploadUrlMock).toHaveBeenCalledTimes(1);
    const [key, contentType] = createSignedUploadUrlMock.mock.calls[0];
    expect(key).toMatch(/^tenants\/tenant-1\/applicants\/lead-1\/documents\/.+\/versions\/.+\/original\.pdf$/);
    expect(contentType).toBe("application/pdf");
  });
});

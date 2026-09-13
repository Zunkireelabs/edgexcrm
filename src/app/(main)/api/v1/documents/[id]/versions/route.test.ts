import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

const authenticateRequestMock = vi.fn();
const getFeatureAccessMock = vi.fn();
const scopedClientMock = vi.fn();
const assertDocumentVisibleMock = vi.fn();
const getDocumentStorageProviderMock = vi.fn();
const createSignedUploadUrlMock = vi.fn();
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
const DOCUMENT = { id: "doc-1", lead_id: "lead-1" };
const VALID_CHECKSUM = "b".repeat(64);

function fakeReq(body?: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function params() {
  return { params: Promise.resolve({ id: "doc-1" }) };
}

function fakeDb(opts: {
  versions?: Record<string, unknown>[];
  maxVersion?: { version_number: number } | null;
  createdVersion?: Record<string, unknown>;
  updatedDoc?: Record<string, unknown>;
} = {}) {
  const listQuery = { eq: vi.fn(() => listQuery), order: vi.fn(() => Promise.resolve({ data: opts.versions ?? [], error: null })) };
  const maxQuery = {
    eq: vi.fn(() => maxQuery),
    order: vi.fn(() => maxQuery),
    limit: vi.fn(() => maxQuery),
    maybeSingle: vi.fn(async () => ({ data: opts.maxVersion ?? null })),
  };
  const insertSelect = { single: vi.fn(async () => ({ data: opts.createdVersion ?? { id: "v2", version_number: 2 }, error: null })) };
  const versionTable = {
    select: vi.fn((columns?: string) => {
      // GET uses select().eq().order(); the max-version lookup uses select().eq().order().limit().maybeSingle()
      return columns === "version_number" ? maxQuery : listQuery;
    }),
    insert: vi.fn(() => ({ select: vi.fn(() => insertSelect) })),
  };

  const docUpdateSelect = { single: vi.fn(async () => ({ data: opts.updatedDoc ?? { id: "doc-1", current_version_id: "v2" }, error: null })) };
  const docTable = { update: vi.fn(() => ({ eq: vi.fn(() => ({ select: vi.fn(() => docUpdateSelect) })) })) };

  const usageTable = { insert: vi.fn(async () => ({ error: null })) };
  const settingsQuery = { maybeSingle: vi.fn(async () => ({ data: null })) };
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

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    original_filename: "transcript-v2.pdf",
    mime_type: "application/pdf",
    file_size: 2048,
    checksum: VALID_CHECKSUM,
    ...overrides,
  };
}

beforeEach(() => {
  authenticateRequestMock.mockReset();
  getFeatureAccessMock.mockReset();
  scopedClientMock.mockReset();
  assertDocumentVisibleMock.mockReset();
  getDocumentStorageProviderMock.mockReset();
  createSignedUploadUrlMock.mockReset();
  createAuditLogMock.mockReset();
  emitEventMock.mockReset();

  authenticateRequestMock.mockResolvedValue(AUTH);
  getFeatureAccessMock.mockReturnValue(true);
  assertDocumentVisibleMock.mockResolvedValue({ document: DOCUMENT, lead: LEAD });
  getDocumentStorageProviderMock.mockReturnValue({ createSignedUploadUrl: createSignedUploadUrlMock });
  createSignedUploadUrlMock.mockResolvedValue({ url: "https://r2.example/signed-put-v2" });
  createAuditLogMock.mockResolvedValue(undefined);
  emitEventMock.mockResolvedValue(null);
});

describe("GET /api/v1/documents/[id]/versions", () => {
  it("401s when unauthenticated", async () => {
    authenticateRequestMock.mockResolvedValue(null);
    const { GET } = await import("./route");
    const res = await GET(fakeReq(), params());
    expect(res.status).toBe(401);
  });

  it("404s when the document isn't visible", async () => {
    assertDocumentVisibleMock.mockResolvedValue(null);
    scopedClientMock.mockResolvedValue(fakeDb());
    const { GET } = await import("./route");
    const res = await GET(fakeReq(), params());
    expect(res.status).toBe(404);
  });

  it("returns version history newest-first", async () => {
    const versions = [
      { id: "v2", version_number: 2 },
      { id: "v1", version_number: 1 },
    ];
    scopedClientMock.mockResolvedValue(fakeDb({ versions }));
    const { GET } = await import("./route");
    const res = await GET(fakeReq(), params());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual(versions);
  });
});

describe("POST /api/v1/documents/[id]/versions — issues an upload URL only, writes nothing to the DB", () => {
  it("404s when the document isn't visible", async () => {
    assertDocumentVisibleMock.mockResolvedValue(null);
    scopedClientMock.mockResolvedValue(fakeDb());
    const { POST } = await import("./route");
    const res = await POST(fakeReq(validBody()), params());
    expect(res.status).toBe(404);
  });

  it("422s on an unsupported mime type", async () => {
    scopedClientMock.mockResolvedValue(fakeDb());
    const { POST } = await import("./route");
    const res = await POST(fakeReq(validBody({ mime_type: "application/zip", original_filename: "archive.zip" })), params());
    expect(res.status).toBe(422);
  });

  it("THE FIX: writes nothing to the database — no version row, no re-pointing current_version_id, no audit log", async () => {
    const db = fakeDb();
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST(fakeReq(validBody()), params());

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.upload_url).toBe("https://r2.example/signed-put-v2");
    expect(typeof json.data.version_id).toBe("string");
    const versionTable = db.from("applicant_document_versions") as unknown as { insert: ReturnType<typeof vi.fn> };
    expect(versionTable.insert).not.toHaveBeenCalled();
    const docTable = db.from("applicant_documents") as unknown as { update: ReturnType<typeof vi.fn> };
    expect(docTable.update).not.toHaveBeenCalled();
    expect(createAuditLogMock).not.toHaveBeenCalled();
  });

  it("builds the storage key from the document's own lead_id, not a caller-supplied one", async () => {
    scopedClientMock.mockResolvedValue(fakeDb());
    const { POST } = await import("./route");
    await POST(fakeReq(validBody()), params());

    const [key] = createSignedUploadUrlMock.mock.calls[0];
    expect(key).toMatch(/^tenants\/tenant-1\/applicants\/lead-1\/documents\/doc-1\/versions\/.+\/original\.pdf$/);
  });
});

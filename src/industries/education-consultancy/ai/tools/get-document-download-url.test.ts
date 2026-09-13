import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScopedClient } from "@/lib/supabase/scoped";
import type { AuthContext } from "@/lib/api/auth";
import type { ToolContext } from "@/lib/ai/tools/types";

const assertDocumentVisibleMock = vi.fn();
const getFeatureAccessMock = vi.fn();
const getDocumentStorageProviderMock = vi.fn();
const createSignedDownloadUrlMock = vi.fn();
const createAuditLogMock = vi.fn();
const emitEventMock = vi.fn();

vi.mock("@/lib/documents/access", () => ({ assertDocumentVisible: assertDocumentVisibleMock }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: getFeatureAccessMock }));
vi.mock("@/lib/documents/storage/r2-provider", () => ({ getDocumentStorageProvider: getDocumentStorageProviderMock }));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: createAuditLogMock, emitEvent: emitEventMock }));

type Row = Record<string, unknown>;

function versionChain(row: Row | null) {
  const c: Record<string, unknown> = {};
  c.select = () => c;
  c.eq = () => c;
  c.maybeSingle = async () => ({ data: row, error: null });
  return c;
}

function fakeDb(versionRow: Row | null): ScopedClient & { usageInsert: ReturnType<typeof vi.fn> } {
  const usageInsert = vi.fn(async () => ({ error: null }));
  const db = {
    from: (table: string) => {
      if (table === "applicant_document_versions") return versionChain(versionRow);
      if (table === "document_usage_events") return { insert: usageInsert };
      throw new Error(`unexpected table ${table}`);
    },
    fromGlobal: () => {
      throw new Error("not used in this test");
    },
    raw: () => {
      throw new Error("not used in this test");
    },
  } as unknown as ScopedClient & { usageInsert: typeof usageInsert };
  db.usageInsert = usageInsert;
  return db;
}

function fixtureAuth(): AuthContext {
  return {
    userId: "user-1",
    email: "test@example.com",
    tenantId: "tenant-1",
    role: "staff",
    industryId: "education_consultancy",
    positionId: null,
    positionSlug: null,
    branchId: null,
    branchMemberIds: [],
    permissions: { baseTier: "member", leadScope: "own", pipelineAccess: "all" } as AuthContext["permissions"],
    plan: "free",
    entitlements: {} as AuthContext["entitlements"],
  };
}

function fixtureCtx(db: ScopedClient): ToolContext {
  return { db, auth: fixtureAuth(), logger: { child: () => ({}) } as unknown as ToolContext["logger"], runId: "run-1" };
}

const DOC_WITH_VERSION = { id: "doc-1", current_version_id: "version-1" };
const VERSION_ROW = { id: "version-1", storage_key: "tenants/t1/applicants/l1/documents/doc-1/versions/version-1/original.pdf" };

describe("get_document_download_url", () => {
  beforeEach(() => {
    assertDocumentVisibleMock.mockReset();
    getFeatureAccessMock.mockReset();
    getDocumentStorageProviderMock.mockReset();
    createSignedDownloadUrlMock.mockReset();
    createAuditLogMock.mockReset();
    emitEventMock.mockReset();
    getFeatureAccessMock.mockReturnValue(true);
    getDocumentStorageProviderMock.mockReturnValue({ createSignedDownloadUrl: createSignedDownloadUrlMock });
    createAuditLogMock.mockResolvedValue(undefined);
    emitEventMock.mockResolvedValue(null);
  });

  it("returns 'Document not found.' when not visible", async () => {
    assertDocumentVisibleMock.mockResolvedValue(null);
    const { getDocumentDownloadUrlTool } = await import("./get-document-download-url");
    const result = await getDocumentDownloadUrlTool.execute(fixtureCtx(fakeDb(null)), { documentId: "doc-1" });
    expect(result).toEqual({ error: "Document not found." });
  });

  it("returns an error when the document has no current version", async () => {
    assertDocumentVisibleMock.mockResolvedValue({ document: { id: "doc-1", current_version_id: null }, lead: { id: "lead-1" } });
    const { getDocumentDownloadUrlTool } = await import("./get-document-download-url");
    const result = await getDocumentDownloadUrlTool.execute(fixtureCtx(fakeDb(null)), { documentId: "doc-1" });
    expect(result).toEqual({ error: "Document has no available version." });
  });

  it("returns a signed url and audit-logs the download, same as the human download-url route", async () => {
    assertDocumentVisibleMock.mockResolvedValue({ document: DOC_WITH_VERSION, lead: { id: "lead-1" } });
    createSignedDownloadUrlMock.mockResolvedValue("https://r2.example.com/signed-url");
    const db = fakeDb(VERSION_ROW);
    const { getDocumentDownloadUrlTool } = await import("./get-document-download-url");
    const result = await getDocumentDownloadUrlTool.execute(fixtureCtx(db), { documentId: "doc-1" });

    expect(result).toEqual({ url: "https://r2.example.com/signed-url", expiresInSeconds: 600 });
    expect(createSignedDownloadUrlMock).toHaveBeenCalledWith(VERSION_ROW.storage_key, 600);
    expect(db.usageInsert).toHaveBeenCalledWith(expect.objectContaining({ event_type: "download", resource_id: "doc-1" }));
    expect(createAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({ action: "document.downloaded", entityId: "doc-1" }));
  });

  it("returns an error when the signing call itself fails", async () => {
    assertDocumentVisibleMock.mockResolvedValue({ document: DOC_WITH_VERSION, lead: { id: "lead-1" } });
    createSignedDownloadUrlMock.mockRejectedValue(new Error("R2 unreachable"));
    const { getDocumentDownloadUrlTool } = await import("./get-document-download-url");
    const result = await getDocumentDownloadUrlTool.execute(fixtureCtx(fakeDb(VERSION_ROW)), { documentId: "doc-1" });
    expect(result).toEqual({ error: "Failed to create a download link — please try again." });
  });
});

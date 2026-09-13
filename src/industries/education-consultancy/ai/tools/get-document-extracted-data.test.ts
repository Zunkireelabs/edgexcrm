import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScopedClient } from "@/lib/supabase/scoped";
import type { AuthContext } from "@/lib/api/auth";
import type { ToolContext } from "@/lib/ai/tools/types";

const assertDocumentVisibleMock = vi.fn();
const getFeatureAccessMock = vi.fn();
vi.mock("@/lib/documents/access", () => ({ assertDocumentVisible: assertDocumentVisibleMock }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: getFeatureAccessMock }));

type Row = Record<string, unknown>;

function extractionChain(row: Row | null) {
  const c: Record<string, unknown> = {};
  c.select = () => c;
  c.eq = () => c;
  c.order = () => c;
  c.limit = () => c;
  c.maybeSingle = async () => ({ data: row, error: null });
  return c;
}

function fakeDb(extractionRow: Row | null): ScopedClient {
  return {
    from: (table: string) => {
      if (table === "applicant_document_extractions") return extractionChain(extractionRow);
      throw new Error(`unexpected table ${table}`);
    },
    fromGlobal: () => {
      throw new Error("not used in this test");
    },
    raw: () => {
      throw new Error("not used in this test");
    },
  } as unknown as ScopedClient;
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

describe("get_document_extracted_data", () => {
  beforeEach(() => {
    assertDocumentVisibleMock.mockReset();
    getFeatureAccessMock.mockReset();
    getFeatureAccessMock.mockReturnValue(true);
    assertDocumentVisibleMock.mockResolvedValue({ document: { id: "doc-1" }, lead: { id: "lead-1" } });
  });

  it("returns 'Document not found.' when not visible", async () => {
    assertDocumentVisibleMock.mockResolvedValue(null);
    const { getDocumentExtractedDataTool } = await import("./get-document-extracted-data");
    const result = await getDocumentExtractedDataTool.execute(fixtureCtx(fakeDb(null)), { documentId: "doc-1" });
    expect(result).toEqual({ error: "Document not found." });
  });

  it("reports nothing extracted yet when no extraction row exists (the common case — Phase 3 doesn't populate this)", async () => {
    const { getDocumentExtractedDataTool } = await import("./get-document-extracted-data");
    const result = await getDocumentExtractedDataTool.execute(fixtureCtx(fakeDb(null)), { documentId: "doc-1" });
    expect(result).toEqual({ error: "No structured data has been extracted from this document yet." });
  });

  it("returns the latest extraction's structured data when present", async () => {
    const { getDocumentExtractedDataTool } = await import("./get-document-extracted-data");
    const row = {
      extraction_type: "passport",
      structured_data: { passportNumber: "P1234567" },
      confidence: 0.92,
      created_at: "2026-01-01T00:00:00Z",
    };
    const result = await getDocumentExtractedDataTool.execute(fixtureCtx(fakeDb(row)), { documentId: "doc-1" });
    expect(result).toEqual({
      extractionType: "passport",
      data: { passportNumber: "P1234567" },
      confidence: 0.92,
      extractedAt: "2026-01-01T00:00:00Z",
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScopedClient } from "@/lib/supabase/scoped";
import type { AuthContext } from "@/lib/api/auth";
import type { ToolContext } from "@/lib/ai/tools/types";

const assertDocumentVisibleMock = vi.fn();
const getFeatureAccessMock = vi.fn();
vi.mock("@/lib/documents/access", () => ({ assertDocumentVisible: assertDocumentVisibleMock }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: getFeatureAccessMock }));

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

function fixtureCtx(): ToolContext {
  return {
    db: {} as ScopedClient,
    auth: fixtureAuth(),
    logger: { child: () => ({}) } as unknown as ToolContext["logger"],
    runId: "run-1",
  };
}

const DOC_ROW = {
  id: "doc-1",
  name: "Passport.pdf",
  document_type: "passport",
  status: "ready",
  verification_status: "verified",
  file_size: 12345,
  description: null,
  created_at: "2026-01-01T00:00:00Z",
  processed_at: "2026-01-01T00:05:00Z",
};

describe("get_document_metadata", () => {
  beforeEach(() => {
    assertDocumentVisibleMock.mockReset();
    getFeatureAccessMock.mockReset();
    getFeatureAccessMock.mockReturnValue(true);
  });

  it("refuses when the feature isn't available for this tenant's industry", async () => {
    getFeatureAccessMock.mockReturnValue(false);
    const { getDocumentMetadataTool } = await import("./get-document-metadata");
    const result = await getDocumentMetadataTool.execute(fixtureCtx(), { documentId: "doc-1" });
    expect(result).toEqual({ error: "Document management is not available for this tenant." });
    expect(assertDocumentVisibleMock).not.toHaveBeenCalled();
  });

  it("returns 'Document not found.' when the document doesn't exist or isn't visible", async () => {
    assertDocumentVisibleMock.mockResolvedValue(null);
    const { getDocumentMetadataTool } = await import("./get-document-metadata");
    const result = await getDocumentMetadataTool.execute(fixtureCtx(), { documentId: "doc-missing" });
    expect(result).toEqual({ error: "Document not found." });
  });

  it("returns metadata with type/category labels when visible", async () => {
    assertDocumentVisibleMock.mockResolvedValue({ document: DOC_ROW, lead: { id: "lead-1" } });
    const { getDocumentMetadataTool } = await import("./get-document-metadata");
    const result = (await getDocumentMetadataTool.execute(fixtureCtx(), { documentId: "doc-1" })) as {
      documentTypeLabel: string;
      category: string;
      status: string;
      verificationStatus: string;
    };
    expect(result).toMatchObject({
      documentTypeLabel: "Passport",
      category: "Identity",
      status: "ready",
      verificationStatus: "verified",
    });
  });
});

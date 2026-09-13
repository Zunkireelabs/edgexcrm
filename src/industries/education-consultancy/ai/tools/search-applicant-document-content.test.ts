import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScopedClient } from "@/lib/supabase/scoped";
import type { AuthContext } from "@/lib/api/auth";
import type { ToolContext } from "@/lib/ai/tools/types";

const assertLeadVisibleMock = vi.fn();
const getFeatureAccessMock = vi.fn();
const retrieveDocumentsMock = vi.fn();
vi.mock("@/lib/documents/access", () => ({ assertLeadVisible: assertLeadVisibleMock }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: getFeatureAccessMock }));
vi.mock("@/lib/documents/retrieval/retrieve", () => ({ retrieveDocuments: retrieveDocumentsMock }));

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

const LEAD_ROW = { id: "lead-1", assigned_to: "user-1", branch_id: null, pipeline_id: "pipe-1", list_id: null };

describe("search_applicant_document_content", () => {
  beforeEach(() => {
    assertLeadVisibleMock.mockReset();
    getFeatureAccessMock.mockReset();
    retrieveDocumentsMock.mockReset();
    getFeatureAccessMock.mockReturnValue(true);
    assertLeadVisibleMock.mockResolvedValue(LEAD_ROW);
  });

  it("refuses a lead the caller can't view, without calling retrieveDocuments", async () => {
    assertLeadVisibleMock.mockResolvedValue(null);
    const { searchApplicantDocumentContentTool } = await import("./search-applicant-document-content");
    const result = await searchApplicantDocumentContentTool.execute(fixtureCtx(), { leadId: "lead-1", query: "passport number", limit: 8 });
    expect(result).toEqual({ error: "Lead not found." });
    expect(retrieveDocumentsMock).not.toHaveBeenCalled();
  });

  it("passes leadId/query/limit through to retrieveDocuments and returns citations", async () => {
    retrieveDocumentsMock.mockResolvedValue({
      chunks: [
        {
          chunkId: "chunk-1",
          documentId: "doc-1",
          documentVersionId: "v-1",
          chunkIndex: 0,
          content: "Passport number: P1234567",
          score: 0.05,
          documentName: "Passport.pdf",
          documentType: "passport",
          page: 1,
        },
      ],
      degraded: false,
    });
    const { searchApplicantDocumentContentTool } = await import("./search-applicant-document-content");
    const result = (await searchApplicantDocumentContentTool.execute(fixtureCtx(), {
      leadId: "lead-1",
      query: "passport number",
      limit: 8,
    })) as { results: Array<{ snippet: string; citation: { documentName: string; documentType: string; page?: number } }> };

    expect(retrieveDocumentsMock).toHaveBeenCalledWith(expect.anything(), "tenant-1", "lead-1", "passport number", 8);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].snippet).toContain("P1234567");
    expect(result.results[0].citation).toMatchObject({ documentName: "Passport.pdf", documentType: "Passport", page: 1 });
  });

  it("adds a note (not an error) when nothing matches", async () => {
    retrieveDocumentsMock.mockResolvedValue({ chunks: [], degraded: false });
    const { searchApplicantDocumentContentTool } = await import("./search-applicant-document-content");
    const result = (await searchApplicantDocumentContentTool.execute(fixtureCtx(), { leadId: "lead-1", query: "x", limit: 8 })) as {
      results: unknown[];
      note?: string;
    };
    expect(result.results).toEqual([]);
    expect(result.note).toContain("No matching content");
  });

  it("surfaces the degraded flag as a note when the search fell back to keyword-only", async () => {
    retrieveDocumentsMock.mockResolvedValue({
      chunks: [
        { chunkId: "c1", documentId: "d1", documentVersionId: "v1", chunkIndex: 0, content: "text", score: 0, documentName: "Doc.pdf", documentType: "other" },
      ],
      degraded: true,
    });
    const { searchApplicantDocumentContentTool } = await import("./search-applicant-document-content");
    const result = (await searchApplicantDocumentContentTool.execute(fixtureCtx(), { leadId: "lead-1", query: "x", limit: 8 })) as { note?: string };
    expect(result.note).toContain("keyword-only");
  });
});

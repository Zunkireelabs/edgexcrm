import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScopedClient } from "@/lib/supabase/scoped";
import type { AuthContext } from "@/lib/api/auth";
import type { ToolContext } from "@/lib/ai/tools/types";

const assertLeadVisibleMock = vi.fn();
const getFeatureAccessMock = vi.fn();
vi.mock("@/lib/documents/access", () => ({ assertLeadVisible: assertLeadVisibleMock }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: getFeatureAccessMock }));

type Row = Record<string, unknown>;

function selectChain(rows: Row[]) {
  const c: Record<string, unknown> = {};
  c.select = () => c;
  c.eq = () => c;
  c.is = () => c;
  c.order = () => c;
  c.then = (resolve: (v: { data: Row[]; error: null }) => unknown) =>
    Promise.resolve({ data: rows, error: null }).then(resolve);
  return c;
}

function fakeDb(documentRows: Row[]): ScopedClient {
  return {
    from: (table: string) => {
      if (table === "applicant_documents") return selectChain(documentRows);
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

const LEAD_ROW = { id: "lead-1", assigned_to: "user-1", branch_id: null, pipeline_id: "pipe-1", list_id: null };

const DOC_ROW = {
  id: "doc-1",
  document_type: "passport",
  name: "Passport.pdf",
  status: "ready",
  verification_status: "unverified",
  created_at: "2026-01-01T00:00:00Z",
};

describe("list_applicant_documents", () => {
  beforeEach(() => {
    assertLeadVisibleMock.mockReset();
    getFeatureAccessMock.mockReset();
    getFeatureAccessMock.mockReturnValue(true);
  });

  it("refuses when the feature isn't available for this tenant's industry", async () => {
    getFeatureAccessMock.mockReturnValue(false);
    const { listApplicantDocumentsTool } = await import("./list-applicant-documents");
    const result = await listApplicantDocumentsTool.execute(fixtureCtx(fakeDb([])), { leadId: "lead-1" });
    expect(result).toEqual({ error: "Document management is not available for this tenant." });
    expect(assertLeadVisibleMock).not.toHaveBeenCalled();
  });

  it("refuses a lead the caller can't view", async () => {
    assertLeadVisibleMock.mockResolvedValue(null);
    const { listApplicantDocumentsTool } = await import("./list-applicant-documents");
    const result = await listApplicantDocumentsTool.execute(fixtureCtx(fakeDb([DOC_ROW])), { leadId: "lead-1" });
    expect(result).toEqual({ error: "Lead not found." });
  });

  it("returns documents grouped with type/category labels when the caller can view the lead", async () => {
    assertLeadVisibleMock.mockResolvedValue(LEAD_ROW);
    const { listApplicantDocumentsTool } = await import("./list-applicant-documents");
    const result = (await listApplicantDocumentsTool.execute(fixtureCtx(fakeDb([DOC_ROW])), { leadId: "lead-1" })) as {
      documents: Array<{ id: string; documentTypeLabel: string; category: string; status: string }>;
    };
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]).toMatchObject({
      id: "doc-1",
      documentTypeLabel: "Passport",
      category: "Identity",
      status: "ready",
    });
  });
});

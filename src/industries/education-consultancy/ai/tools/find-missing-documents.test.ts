import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScopedClient } from "@/lib/supabase/scoped";
import type { AuthContext } from "@/lib/api/auth";
import type { ToolContext } from "@/lib/ai/tools/types";

const assertLeadVisibleMock = vi.fn();
const getFeatureAccessMock = vi.fn();
vi.mock("@/lib/documents/access", () => ({ assertLeadVisible: assertLeadVisibleMock }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: getFeatureAccessMock }));

type Row = Record<string, unknown>;

function settingsChain(row: Row | null) {
  const c: Record<string, unknown> = {};
  c.select = () => c;
  c.maybeSingle = async () => ({ data: row, error: null });
  return c;
}

function documentsChain(rows: Row[]) {
  const c: Record<string, unknown> = {};
  c.select = () => c;
  c.eq = () => c;
  c.is = () => c;
  c.then = (resolve: (v: { data: Row[]; error: null }) => unknown) =>
    Promise.resolve({ data: rows, error: null }).then(resolve);
  return c;
}

function fakeDb(settingsRow: Row | null, documentRows: Row[]): ScopedClient {
  return {
    from: (table: string) => {
      if (table === "tenant_document_settings") return settingsChain(settingsRow);
      if (table === "applicant_documents") return documentsChain(documentRows);
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

describe("find_missing_documents", () => {
  beforeEach(() => {
    assertLeadVisibleMock.mockReset();
    getFeatureAccessMock.mockReset();
    getFeatureAccessMock.mockReturnValue(true);
    assertLeadVisibleMock.mockResolvedValue(LEAD_ROW);
  });

  it("refuses a lead the caller can't view", async () => {
    assertLeadVisibleMock.mockResolvedValue(null);
    const { findMissingDocumentsTool } = await import("./find-missing-documents");
    const result = await findMissingDocumentsTool.execute(fixtureCtx(fakeDb(null, [])), { leadId: "lead-1" });
    expect(result).toEqual({ error: "Lead not found." });
  });

  it("returns an empty missing list with a note when the tenant has no required-documents checklist", async () => {
    const { findMissingDocumentsTool } = await import("./find-missing-documents");
    const result = await findMissingDocumentsTool.execute(fixtureCtx(fakeDb(null, [])), { leadId: "lead-1" });
    expect(result).toEqual({ missing: [], note: "This tenant has no required-documents checklist configured." });
  });

  it("reports the required types the lead hasn't uploaded", async () => {
    const settings = { required_document_types: ["passport", "transcript", "bank_statement"] };
    const uploaded = [{ document_type: "passport" }];
    const { findMissingDocumentsTool } = await import("./find-missing-documents");
    const result = (await findMissingDocumentsTool.execute(fixtureCtx(fakeDb(settings, uploaded)), { leadId: "lead-1" })) as {
      missing: Array<{ documentType: string }>;
      complete: boolean;
    };
    expect(result.complete).toBe(false);
    expect(result.missing.map((m) => m.documentType).sort()).toEqual(["bank_statement", "transcript"]);
  });

  it("reports complete:true when every required type is uploaded", async () => {
    const settings = { required_document_types: ["passport"] };
    const uploaded = [{ document_type: "passport" }];
    const { findMissingDocumentsTool } = await import("./find-missing-documents");
    const result = (await findMissingDocumentsTool.execute(fixtureCtx(fakeDb(settings, uploaded)), { leadId: "lead-1" })) as { missing: unknown[]; complete: boolean };
    expect(result.missing).toEqual([]);
    expect(result.complete).toBe(true);
  });
});

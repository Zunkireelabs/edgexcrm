// Security/isolation tests for the shared access gate every applicant-documents
// route goes through. Uses the REAL canViewLead (not mocked) against a fake
// ScopedClient, so these prove the actual gating logic — not just that a route
// calls a mocked helper. Cross-tenant isolation is proven the same way the rest
// of this codebase proves it for a scopedClient-backed lookup: a foreign
// tenant's row is simply never found (scopedClient auto-injects the tenant_id
// filter), so a "wrong tenant" id behaves identically to a "doesn't exist" id.
import { describe, it, expect } from "vitest";
import type { ScopedClient } from "@/lib/supabase/scoped";
import type { AuthContext } from "@/lib/api/auth";
import { assertLeadVisible, assertDocumentVisible } from "./access";

function chain(result: { data: unknown }) {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.is = () => builder;
  builder.order = () => builder;
  builder.limit = () => builder;
  builder.maybeSingle = async () => result;
  (builder as { then: unknown }).then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function fakeDb(tables: Record<string, { data: unknown }>): ScopedClient {
  return {
    from: (table: string) => chain(tables[table] ?? { data: null }),
  } as unknown as ScopedClient;
}

function ownScopeAuth(userId: string): AuthContext {
  return {
    userId,
    email: "u@example.com",
    tenantId: "tenant-1",
    role: "staff",
    industryId: "education_consultancy",
    positionId: null,
    positionSlug: null,
    branchId: null,
    branchMemberIds: [],
    permissions: { baseTier: "member", leadScope: "own", pipelineAccess: "all", canEditLeads: true },
    plan: "starter",
    entitlements: {} as AuthContext["entitlements"],
  } as unknown as AuthContext;
}

describe("assertLeadVisible", () => {
  it("returns the lead when the caller is its assignee (own-scope)", async () => {
    const auth = ownScopeAuth("user-1");
    const lead = { id: "lead-1", assigned_to: "user-1", branch_id: null, pipeline_id: "pipe-1", list_id: null };
    const db = fakeDb({ leads: { data: lead }, lead_branches: { data: [] } });

    const result = await assertLeadVisible(db, auth, "lead-1");
    expect(result).toEqual(lead);
  });

  it("returns null for a lead assigned to someone else and the caller is not a collaborator — the 'non-assigned counselor can't see a lead's documents' case", async () => {
    const auth = ownScopeAuth("user-1");
    const lead = { id: "lead-2", assigned_to: "other-user", branch_id: null, pipeline_id: "pipe-1", list_id: null };
    const db = fakeDb({
      leads: { data: lead },
      lead_branches: { data: [] },
      lead_collaborators: { data: null },
    });

    const result = await assertLeadVisible(db, auth, "lead-2");
    expect(result).toBeNull();
  });

  it("returns the lead when the caller IS a collaborator, even though not the assignee", async () => {
    const auth = ownScopeAuth("user-1");
    const lead = { id: "lead-3", assigned_to: "other-user", branch_id: null, pipeline_id: "pipe-1", list_id: null };
    const db = fakeDb({
      leads: { data: lead },
      lead_branches: { data: [] },
      lead_collaborators: { data: { lead_id: "lead-3" } },
    });

    const result = await assertLeadVisible(db, auth, "lead-3");
    expect(result).toEqual(lead);
  });

  it("returns null for a lead id that doesn't resolve under the tenant-scoped client — the cross-tenant isolation case (Tenant A can't touch Tenant B's lead)", async () => {
    const auth = ownScopeAuth("user-1");
    // scopedClient auto-injects tenant_id — a foreign tenant's lead id simply
    // never comes back, indistinguishable from a nonexistent id.
    const db = fakeDb({ leads: { data: null } });

    const result = await assertLeadVisible(db, auth, "lead-in-another-tenant");
    expect(result).toBeNull();
  });
});

describe("assertDocumentVisible", () => {
  it("returns null when the document id doesn't resolve under the tenant-scoped client — Tenant A can't touch Tenant B's document", async () => {
    const auth = ownScopeAuth("user-1");
    const db = fakeDb({ applicant_documents: { data: null } });

    const result = await assertDocumentVisible(db, auth, "doc-in-another-tenant");
    expect(result).toBeNull();
  });

  it("returns null when the document exists but the caller cannot view its owning lead", async () => {
    const auth = ownScopeAuth("user-1");
    const document = { id: "doc-1", lead_id: "lead-2", tenant_id: "tenant-1" };
    const lead = { id: "lead-2", assigned_to: "other-user", branch_id: null, pipeline_id: "pipe-1", list_id: null };
    const db = fakeDb({
      applicant_documents: { data: document },
      leads: { data: lead },
      lead_branches: { data: [] },
      lead_collaborators: { data: null },
    });

    const result = await assertDocumentVisible(db, auth, "doc-1");
    expect(result).toBeNull();
  });

  it("returns the document + lead when the document exists and the caller can view its lead", async () => {
    const auth = ownScopeAuth("user-1");
    const document = { id: "doc-1", lead_id: "lead-1", tenant_id: "tenant-1" };
    const lead = { id: "lead-1", assigned_to: "user-1", branch_id: null, pipeline_id: "pipe-1", list_id: null };
    const db = fakeDb({
      applicant_documents: { data: document },
      leads: { data: lead },
      lead_branches: { data: [] },
    });

    const result = await assertDocumentVisible(db, auth, "doc-1");
    expect(result).toEqual({ document, lead });
  });
});

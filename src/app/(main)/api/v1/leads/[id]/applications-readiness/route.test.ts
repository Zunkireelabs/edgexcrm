import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// The read-only pre-check behind the "Send to next" warning: it must report exactly what the shared
// readiness rule says, honour tenant/lead scope, and never gate non-education tenants.

const state = vi.hoisted(() => ({
  industry: "education_consultancy",
  lead: { id: "lead-1", assigned_to: "user-1", branch_id: null } as Record<string, unknown> | null,
  restricted: false,
  readiness: { ready: false, missing: ["Processing fee", "Consent signed"] } as { ready: boolean; missing: string[] },
  checkedWith: null as unknown[] | null,
}));

vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: vi.fn(async () => ({
    userId: "user-1", tenantId: "tenant-1", role: "member", industryId: state.industry, branchId: null,
    permissions: { baseTier: "member", leadScope: "own" },
  })),
  requireLeadBranchAccess: () => true,
}));
vi.mock("@/lib/api/permissions", () => ({ shouldRestrictToSelf: () => state.restricted }));
vi.mock("@/lib/leads/branch-membership", () => ({ getLeadMembership: async () => [] }));
vi.mock("@/lib/leads/collaborators", () => ({ isLeadCollaborator: async () => false }));
vi.mock("@/lib/leads/applications-readiness", async (orig) => {
  const actual = await orig<typeof import("@/lib/leads/applications-readiness")>();
  return {
    ...actual,
    checkApplicationsReadiness: vi.fn(async (...args: unknown[]) => {
      state.checkedWith = args;
      return state.readiness;
    }),
  };
});
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is"]) b[m] = () => b;
    b.single = async () => ({ data: state.lead, error: null });
    return { from: () => b };
  },
}));

const call = async () => {
  const { GET } = await import("./route");
  return GET({} as NextRequest, { params: Promise.resolve({ id: "lead-1" }) });
};

describe("GET /api/v1/leads/:id/applications-readiness", () => {
  beforeEach(() => {
    state.industry = "education_consultancy";
    state.lead = { id: "lead-1", assigned_to: "user-1", branch_id: null };
    state.restricted = false;
    state.readiness = { ready: false, missing: ["Processing fee", "Consent signed"] };
    state.checkedWith = null;
  });

  it("reports what is missing, with the same message the move would give", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ready).toBe(false);
    expect(body.data.missing).toEqual(["Processing fee", "Consent signed"]);
    expect(body.data.message).toBe("Before moving to Applications, complete: Processing fee, Consent signed.");
    expect(state.checkedWith?.[1]).toBe("tenant-1");
    expect(state.checkedWith?.[2]).toBe("lead-1");
  });

  it("is ready when nothing is missing", async () => {
    state.readiness = { ready: true, missing: [] };
    const body = await (await call()).json();
    expect(body.data).toEqual({ ready: true, missing: [], message: null });
  });

  it("never gates a non-education tenant (and doesn't run the check)", async () => {
    state.industry = "it_agency";
    const body = await (await call()).json();
    expect(body.data.ready).toBe(true);
    expect(state.checkedWith).toBeNull();
  });

  it("404s a lead that isn't in this tenant", async () => {
    state.lead = null;
    expect((await call()).status).toBe(404);
  });

  it("404s a lead a restricted (own-scope) user doesn't hold", async () => {
    state.restricted = true;
    state.lead = { id: "lead-1", assigned_to: "someone-else", branch_id: null };
    expect((await call()).status).toBe(404);
    expect(state.checkedWith).toBeNull();
  });
});

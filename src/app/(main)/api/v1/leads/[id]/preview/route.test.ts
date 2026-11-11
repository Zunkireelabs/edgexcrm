import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// Read-only record-preview payload: education only, same visibility as applications-readiness, no DB (all mocked).

const state = vi.hoisted(() => ({
  authed: true,
  industry: "education_consultancy",
  lead: { id: "lead-1", assigned_to: "someone-else", branch_id: null, form_config_id: null, intake_source: "manual_entry", city: "Kathmandu", created_at: "2026-10-10T00:00:00Z", pre_app_fee_status: "paid", intake_term: null, custom_fields: {} } as Record<string, unknown> | null,
  restricted: false,
  collaborator: false,
  tables: {} as Record<string, { data: unknown; count?: number }>,
}));

vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: vi.fn(async () =>
    state.authed ? { userId: "user-1", tenantId: "tenant-1", role: "member", industryId: state.industry, branchId: null, permissions: {} } : null),
  requireLeadBranchAccess: () => true,
}));
vi.mock("@/lib/api/permissions", () => ({ shouldRestrictToSelf: () => state.restricted }));
vi.mock("@/lib/leads/branch-membership", () => ({ getLeadMembership: async () => [] }));
vi.mock("@/lib/leads/collaborators", () => ({ isLeadCollaborator: async () => state.collaborator }));
vi.mock("@/lib/leads/applications-readiness", async (orig) => {
  const actual = await orig<typeof import("@/lib/leads/applications-readiness")>();
  return { ...actual, checkApplicationsReadiness: vi.fn(async () => ({ ready: false, missing: ["Processing fee", "Basic info (Passport Number)", "Consent signed"] })) };
});
vi.mock("@/lib/supabase/queries", () => ({ resolveUserNames: async () => new Map([["user-1", "Binod Rai"]]) }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => ({}) }));
const scoped = vi.hoisted(() => ({ from: null as unknown as (t: string) => unknown }));
vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: async () => ({ fromGlobal: (t: string) => scoped.from(t), from: (t: string) => scoped.from(t) }),
}));
scoped.from = (table: string) => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "neq", "is", "in", "order", "limit"]) b[m] = () => b;
      const result = () => (table === "leads" ? { data: state.lead, error: null } : { data: state.tables[table]?.data ?? null, count: state.tables[table]?.count, error: null });
      b.maybeSingle = async () => result();
      b.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
      return b;
};

const call = async () => {
  const { GET } = await import("./route");
  return GET({ nextUrl: new URL("http://x/api/v1/leads/lead-1/preview") } as unknown as NextRequest, { params: Promise.resolve({ id: "lead-1" }) });
};

describe("GET /api/v1/leads/:id/preview", () => {
  beforeEach(() => {
    state.authed = true;
    state.industry = "education_consultancy";
    state.restricted = false;
    state.collaborator = false;
    state.lead = { id: "lead-1", assigned_to: "someone-else", branch_id: null, form_config_id: null, intake_source: "manual_entry", city: "Kathmandu", created_at: "2026-10-10T00:00:00Z", pre_app_fee_status: "paid", intake_term: null, custom_fields: {} };
    state.tables = {
      tasks: { data: [{ id: "t1", title: "Call", due_date: "2026-11-12", assignee_id: "user-1" }], count: 2 },
      lead_notes: { data: [{ id: "n1", content: "hello", user_id: "user-1", user_email: "a@b.c", created_at: "2026-11-08T00:00:00Z" }], count: 3 },
      lead_activities: { data: [{ id: "a1", user_id: "user-1", activity_type: "call", subject: "wants Feb", description: null, email_subject: null, created_at: "2026-11-08T10:00:00Z" }] },
      audit_logs: { data: [] },
      applications: { data: [], count: 0 },
    };
  });

  it("401 without a session", async () => {
    state.authed = false;
    expect((await call()).status).toBe(401);
  });

  it("403 for a non-education tenant", async () => {
    state.industry = "it_agency";
    expect((await call()).status).toBe(403);
  });

  it("404 for a counsellor who can't see the lead", async () => {
    state.restricted = true;
    expect((await call()).status).toBe(404);
  });

  it("200 for a restricted user who is a collaborator", async () => {
    state.restricted = true;
    state.collaborator = true;
    expect((await call()).status).toBe(200);
  });

  it("404 when the lead doesn't exist in the tenant", async () => {
    state.lead = null;
    expect((await call()).status).toBe(404);
  });

  it("200 with the payload shape", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.tasks.open_count).toBe(2);
    expect(data.tasks.items[0]).toMatchObject({ title: "Call", assignee_name: "Binod Rai" });
    expect(data.notes.count).toBe(3);
    expect(data.notes.latest).toMatchObject({ content: "hello", author_name: "Binod Rai" });
    expect(data.last_touch).toMatchObject({ kind: "call", who_name: "Binod Rai" });
    expect(data.readiness.items).toEqual(["Pre-app fee", "Passport number", "Signed consent"]);
    expect(data.applications.count).toBe(0);
    expect(data.activity.map((a: { id: string }) => a.id)).toEqual(["a-a1", "n-n1", "created-synthetic"])
    expect(data.activity.at(-1)).toMatchObject({ kind: "created", verb: "created the lead", source: "Manual Entry" });
    expect(data).toHaveProperty("source_name");
    expect(data).toHaveProperty("branch_name");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// Integration (API-key) PATCH that changes the assignee: a lead in the default ("Global") branch becomes
// the assignee's branch lead, like the dashboard. No database — hand-rolled fakes.

const gateMock = vi.fn();
const syncOriginMembershipMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/api/integration-helpers", () => ({
  gateIntegrationRequest: gateMock,
  buildLookupMaps: vi.fn(async () => ({ stageMap: new Map(), userMap: new Map() })),
  normalizeLead: (l: unknown) => l,
  logIntegrationAudit: vi.fn().mockResolvedValue(undefined),
  emitIntegrationEvent: vi.fn().mockResolvedValue(undefined),
  withIntegrationErrorBoundary: (fn: unknown) => fn,
}));
vi.mock("@/lib/api/integration-permissions", () => ({ requirePermission: () => null }));
vi.mock("@/lib/leads/collaborators", () => ({ addLeadCollaborator: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/leads/branch-membership", () => ({ syncOriginMembership: syncOriginMembershipMock }));

const GLOBAL = "global-branch";
const KTM = "ktm-branch";
const BIRGUNJ = "birgunj-branch";
const LEAD = "lead-1";
const USER = "user-1";

function table(result: { data?: unknown; error?: unknown }) {
  const o: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in", "limit", "update"]) o[m] = vi.fn(() => o);
  o.single = vi.fn(() => Promise.resolve(result));
  o.maybeSingle = vi.fn(() => Promise.resolve(result));
  return o;
}

function setup(leadBranch: string | null, assigneeBranch: string | null) {
  const leadRow = { id: LEAD, branch_id: leadBranch, assigned_to: null, status: "new" };
  const leads = table({ data: leadRow, error: null });
  (leads.update as ReturnType<typeof vi.fn>).mockImplementation((vals: Record<string, unknown>) =>
    table({ data: { ...leadRow, ...vals }, error: null }),
  );
  const tables: Record<string, ReturnType<typeof table>> = {
    leads,
    tenant_users: table({ data: { user_id: USER, branch_id: assigneeBranch }, error: null }),
    branches: table({ data: { id: GLOBAL }, error: null }),
  };
  gateMock.mockResolvedValue({
    ok: true,
    ctx: {
      auth: { tenantId: "tenant-1", integrationKeyId: "key-1", permissions: ["write"] },
      supabase: { from: (t: string) => tables[t] ?? table({ data: null, error: null }) },
      requestId: "req-1",
      ip: "1.2.3.4",
      userAgent: null,
    },
  });
  return tables;
}

const patch = async (body: Record<string, unknown>) => {
  const { PATCH } = await import("./route");
  const request = { method: "PATCH", json: async () => body, headers: new Headers() } as unknown as NextRequest;
  return PATCH(request, { params: Promise.resolve({ id: LEAD }) });
};

describe("PATCH /integrations/crm/leads/:id — assigning moves a Global lead to the assignee's branch", () => {
  beforeEach(() => {
    gateMock.mockReset();
    syncOriginMembershipMock.mockClear();
  });

  it("Global lead + Birgunj assignee: branch_id moves and the origin row follows", async () => {
    const t = setup(GLOBAL, BIRGUNJ);
    const res = await patch({ assigned_to: USER });
    expect(res.status).toBe(200);
    expect((t.leads.update as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual({ assigned_to: USER, branch_id: BIRGUNJ });
    expect(syncOriginMembershipMock).toHaveBeenCalledWith(expect.anything(), "tenant-1", LEAD, BIRGUNJ, USER);
  });

  it("a lead already in KTM keeps KTM", async () => {
    const t = setup(KTM, BIRGUNJ);
    expect((await patch({ assigned_to: USER })).status).toBe(200);
    expect((t.leads.update as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual({ assigned_to: USER });
    expect(syncOriginMembershipMock).not.toHaveBeenCalled();
  });

  it("a PATCH that doesn't touch the assignee never moves the lead", async () => {
    const t = setup(GLOBAL, BIRGUNJ);
    expect((await patch({ city: "Kathmandu" })).status).toBe(200);
    expect((t.leads.update as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual({ city: "Kathmandu" });
    expect(syncOriginMembershipMock).not.toHaveBeenCalled();
  });

  it("unassigning (assigned_to: null) never moves the lead", async () => {
    const t = setup(GLOBAL, BIRGUNJ);
    expect((await patch({ assigned_to: null })).status).toBe(200);
    expect((t.leads.update as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual({ assigned_to: null });
  });
});

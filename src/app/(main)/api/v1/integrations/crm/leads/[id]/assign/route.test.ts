import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// Integration (API-key) assign: a lead in the default ("Global") branch becomes the assignee's branch
// lead, exactly like assigning from the dashboard. No database — hand-rolled fakes.

const syncOriginMembershipMock = vi.fn().mockResolvedValue(undefined);
const gateMock = vi.fn();

vi.mock("@/lib/api/integration-helpers", () => ({
  gateIntegrationRequest: gateMock,
  buildLookupMaps: vi.fn().mockResolvedValue({ stageMap: new Map(), userMap: new Map() }),
  normalizeLead: (l: unknown) => l,
  logIntegrationAudit: vi.fn().mockResolvedValue(undefined),
  emitIntegrationEvent: vi.fn().mockResolvedValue(undefined),
  checkIdempotency: vi.fn().mockResolvedValue(null),
  storeIdempotency: vi.fn().mockResolvedValue(undefined),
  withIntegrationErrorBoundary: (fn: unknown) => fn,
}));
vi.mock("@/lib/api/integration-permissions", () => ({ requirePermission: () => null }));
vi.mock("@/lib/leads/collaborators", () => ({ addLeadCollaborator: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/leads/branch-membership", () => ({ syncOriginMembership: syncOriginMembershipMock }));

const GLOBAL = "11111111-1111-1111-1111-111111111111";
const KTM = "22222222-2222-2222-2222-222222222222";
const BIRGUNJ = "33333333-3333-3333-3333-333333333333";
const LEAD = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const USER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";

function table(result: { data?: unknown; error?: unknown }) {
  const o: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in", "update", "limit"]) o[m] = vi.fn(() => o);
  o.single = vi.fn(() => Promise.resolve(result));
  o.maybeSingle = vi.fn(() => Promise.resolve(result));
  return o;
}

function setup(leadBranch: string | null, assigneeBranch: string | null) {
  const leadRow = { id: LEAD, branch_id: leadBranch, assigned_to: null };
  const leads = table({ data: leadRow, error: null });
  // The update().select().single() result mirrors what was written.
  (leads.update as ReturnType<typeof vi.fn>).mockImplementation((vals: Record<string, unknown>) => {
    const u = table({ data: { ...leadRow, ...vals }, error: null });
    return u;
  });
  const tables: Record<string, ReturnType<typeof table>> = {
    leads,
    tenant_users: table({ data: { user_id: USER, branch_id: assigneeBranch }, error: null }),
    branches: table({ data: { id: GLOBAL }, error: null }),
  };
  gateMock.mockResolvedValue({
    ok: true,
    ctx: { supabase: { from: (t: string) => tables[t] ?? table({ data: null }) }, auth: { tenantId: "tenant-1" } },
  });
  return tables;
}

const call = async () => {
  const { POST } = await import("./route");
  const request = { json: async () => ({ user_id: USER }), headers: { get: () => null } } as unknown as NextRequest;
  return POST(request, { params: Promise.resolve({ id: LEAD }) });
};

describe("POST /integrations/crm/leads/:id/assign — Global leads move to the assignee's branch", () => {
  beforeEach(() => {
    syncOriginMembershipMock.mockClear();
    gateMock.mockReset();
  });

  it("Global lead + Birgunj assignee: branch_id moves and the origin row follows", async () => {
    const t = setup(GLOBAL, BIRGUNJ);
    const res = await call();
    expect(res.status).toBe(201);
    expect((t.leads.update as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual({ assigned_to: USER, branch_id: BIRGUNJ });
    expect(syncOriginMembershipMock).toHaveBeenCalledWith(expect.anything(), "tenant-1", LEAD, BIRGUNJ, USER);
  });

  it("a lead already in KTM keeps KTM", async () => {
    const t = setup(KTM, BIRGUNJ);
    expect((await call()).status).toBe(201);
    expect((t.leads.update as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual({ assigned_to: USER });
    expect(syncOriginMembershipMock).not.toHaveBeenCalled();
  });

  it("an assignee with no branch leaves a Global lead in Global", async () => {
    const t = setup(GLOBAL, null);
    expect((await call()).status).toBe(201);
    expect((t.leads.update as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual({ assigned_to: USER });
  });
});

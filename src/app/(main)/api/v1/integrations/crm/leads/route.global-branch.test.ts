import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// API-key lead creation: a new lead is attributed to the tenant's default branch ("Global" for Admizz),
// like every other way a lead is created. Tenants with no default branch are unchanged (null branch).
// No database — hand-rolled fakes.

const gateMock = vi.fn();
const syncOriginMembershipMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/api/integration-helpers", () => ({
  gateIntegrationRequest: gateMock,
  buildLookupMaps: vi.fn(async () => ({ stageMap: new Map(), userMap: new Map() })),
  normalizeLead: (l: unknown) => l,
  logIntegrationAudit: vi.fn(),
  emitIntegrationEvent: vi.fn(),
  withIntegrationErrorBoundary: (fn: unknown) => fn,
}));
vi.mock("@/lib/api/integration-permissions", () => ({ requirePermission: () => null }));
vi.mock("@/lib/leads/dedup", () => ({
  normalizeEmail: (e: string) => e,
  normalizePhone: (p: string | null) => p,
  resolveLeadIdentity: vi.fn(async () => ({ match: "none", existingLead: null, phoneMatchLeadIds: [] })),
  applyCanonicalUpdate: vi.fn(() => ({})),
  recordSubmission: vi.fn(async () => "sub-1"),
  recordDuplicateSuggestions: vi.fn(async () => {}),
  emitSubmissionAudit: vi.fn(async () => {}),
  touchLastActivity: vi.fn(async () => {}),
}));
vi.mock("@/lib/leads/pipeline-resolution", () => ({
  resolveLeadPipelineAndStage: vi.fn(async () => ({ ok: true, pipelineId: "pipe-1", stageId: "stage-1", statusSlug: "new" })),
}));
vi.mock("@/lib/leads/assign-display-ids", () => ({ assignDisplayIds: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/leads/branch-membership", () => ({ syncOriginMembership: syncOriginMembershipMock }));

const GLOBAL = "11111111-1111-1111-1111-111111111111";

function table(result: { data?: unknown; error?: unknown }) {
  const o: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in", "limit", "order", "insert", "update"]) o[m] = vi.fn(() => o);
  o.single = vi.fn(() => Promise.resolve(result));
  o.maybeSingle = vi.fn(() => Promise.resolve(result));
  o.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
  return o;
}

function setup(defaultBranchId: string | null) {
  const leads = table({ data: { id: "lead-new" }, error: null });
  const tables: Record<string, ReturnType<typeof table>> = {
    leads,
    tenants: table({ data: { industry_id: "education_consultancy" }, error: null }),
    branches: table({ data: defaultBranchId ? { id: defaultBranchId } : null, error: null }),
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

const post = async () => {
  const { POST } = await import("./route");
  const request = {
    method: "POST",
    json: async () => ({ first_name: "Asha", email: "asha@example.com" }),
    headers: new Headers(),
    nextUrl: { searchParams: new URLSearchParams(), pathname: "/api/v1/integrations/crm/leads" },
  } as unknown as NextRequest;
  return POST(request);
};

describe("POST /integrations/crm/leads — new leads land in the default (Global) branch", () => {
  beforeEach(() => {
    gateMock.mockReset();
    syncOriginMembershipMock.mockClear();
  });

  it("attributes the new lead to the default branch and records its origin row", async () => {
    const t = setup(GLOBAL);
    const res = await post();
    expect(res.status).toBe(201);
    expect((t.leads.insert as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ branch_id: GLOBAL });
    expect(syncOriginMembershipMock).toHaveBeenCalledWith(expect.anything(), "tenant-1", "lead-new", GLOBAL, null);
  });

  it("a tenant with no default branch keeps a null branch (unchanged behaviour) and writes no origin row", async () => {
    const t = setup(null);
    expect((await post()).status).toBe(201);
    expect((t.leads.insert as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ branch_id: null });
    expect(syncOriginMembershipMock).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// New-lead admin email (src/lib/email/notify): the CRM integration route must dispatch it for a brand-new lead
// (once) and must NOT for a duplicate that merges into an existing lead. No database — hand-rolled fakes.

const gateMock = vi.fn();
const dispatchMock = vi.fn(async () => ({ sent: 0, failed: 0, duplicates: 0 }));
const resolveIdentityMock = vi.fn();

vi.mock("@/lib/email/notify", () => ({ dispatchNotificationEmail: dispatchMock, newLeadEvent: { id: "new_lead" } }));
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
  resolveLeadIdentity: resolveIdentityMock,
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
vi.mock("@/lib/leads/branch-membership", () => ({ syncOriginMembership: vi.fn().mockResolvedValue(undefined) }));

function table(result: { data?: unknown; error?: unknown }) {
  const o: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in", "limit", "order", "insert", "update"]) o[m] = vi.fn(() => o);
  o.single = vi.fn(() => Promise.resolve(result));
  o.maybeSingle = vi.fn(() => Promise.resolve(result));
  o.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
  return o;
}

function setup() {
  const tables: Record<string, ReturnType<typeof table>> = {
    leads: table({
      data: { id: "lead-new", first_name: "Asha", last_name: "Rai", email: "asha@example.com", phone: "+977-1", intake_source: "integration" },
      error: null,
    }),
    tenants: table({ data: { industry_id: "education_consultancy" }, error: null }),
    branches: table({ data: null, error: null }),
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
}

const post = async () => {
  const { POST } = await import("./route");
  return POST({
    method: "POST",
    json: async () => ({ first_name: "Asha", email: "asha@example.com" }),
    headers: new Headers(),
    nextUrl: { searchParams: new URLSearchParams(), pathname: "/api/v1/integrations/crm/leads" },
  } as unknown as NextRequest);
};

describe("POST /integrations/crm/leads — new-lead admin email", () => {
  beforeEach(() => {
    gateMock.mockReset();
    dispatchMock.mockClear();
    resolveIdentityMock.mockReset();
  });

  it("a brand-new lead dispatches the alert exactly once, treating 'no stage yet' as New Lead", async () => {
    setup();
    resolveIdentityMock.mockResolvedValue({ match: "none", existingLead: null, phoneMatchLeadIds: [] });
    expect((await post()).status).toBe(201);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "new_lead" }),
      expect.objectContaining({ tenantId: "tenant-1", leadId: "lead-new", firstName: "Asha", isFinal: true, treatNoStageAsNew: true, listId: null })
    );
  });

  it("a duplicate that merges into an existing lead does NOT dispatch (no repeat email for a re-submit)", async () => {
    setup();
    resolveIdentityMock.mockResolvedValue({ match: "email", existingLead: { id: "lead-old" }, phoneMatchLeadIds: [] });
    await post();
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});

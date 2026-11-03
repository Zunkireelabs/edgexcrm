import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/industries/_shared/features/outreach/lib/stage-auto-enroll", () => ({
  onLeadsEnteredStageSafe: vi.fn(async () => ({ stopped: 0, runsCreated: 0, leadsQueued: 0 })),
}));
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

// Proves the bulk Applications gate (fee + basic info + consent): blocks forward moves for
// everyone (admins included), lets backward moves and already-in-Applications leads through.

const authenticateRequestMock = vi.fn();
const createServiceClientMock = vi.fn();

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return { ...actual, authenticateRequest: authenticateRequestMock };
});
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: createServiceClientMock }));
const auditMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: auditMock, emitEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/notifications", () => ({
  createNotificationsExcept: vi.fn(),
  NotificationTypes: { LEAD_ASSIGNED: "lead.assigned", LEAD_UNASSIGNED: "lead.unassigned" },
}));
vi.mock("@/lib/email/send-lead-assigned", () => ({ sendBulkAssignedEmail: vi.fn() }));
vi.mock("@/lib/leads/branch-membership", () => ({ syncOriginMembership: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/leads/collaborators", () => ({ addLeadCollaborators: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/leads/assign-display-ids", () => ({ assignDisplayIds: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/leads/pipeline-stage", () => ({ getPipelineLandingStage: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/logger", () => ({ createRequestLogger: vi.fn(() => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() })) }));

const readinessMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/leads/applications-readiness", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/leads/applications-readiness")>();
  return { ...actual, checkApplicationsReadiness: readinessMock };
});

const LEAD = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const PROSPECTS = "11111111-1111-1111-1111-111111111111";
const QUALIFIED = "22222222-2222-2222-2222-222222222222";
const APPLICATIONS = "33333333-3333-3333-3333-333333333333";
const ENROLLED = "55555555-5555-5555-5555-555555555555";
const STAGING = "44444444-4444-4444-4444-444444444444";

const executive = {
  userId: "exec",
  tenantId: "tenant-1",
  role: "member",
  industryId: "education_consultancy",
  branchId: "branch-1",
  branchMemberIds: ["exec"],
  positionSlug: "lead-executive", // team-scoped (so bulk is reachable) but NOT a branch-manager → no gate bypass
  entitlements: { maxBranches: 3 },
  permissions: { baseTier: "member", leadScope: "team", canAssignLeads: true },
} as unknown as AuthContext;

const admin = {
  ...executive,
  userId: "admin",
  role: "admin",
  positionSlug: null,
  permissions: { baseTier: "admin", leadScope: "all", canAssignLeads: true },
} as unknown as AuthContext;

const req = (body: unknown) => ({ json: async () => body, headers: { get: () => null } }) as unknown as NextRequest;

function table(result: { data?: unknown; error?: unknown }, single?: { data?: unknown }) {
  const o: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in", "not", "update", "insert", "upsert", "order", "limit", "neq", "or"]) o[m] = vi.fn(() => o);
  o.single = vi.fn(() => Promise.resolve(single ?? result));
  o.maybeSingle = vi.fn(() => Promise.resolve(single ?? result));
  o.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
  return o;
}

// currentListId = where the lead is now. The lead has NO academic data in every case.
function setup(currentListId: string) {
  const tables: Record<string, ReturnType<typeof table>> = {
    leads: table({
      data: [{ id: LEAD, assigned_to: "exec", branch_id: "branch-1", list_id: currentListId, status: "new" }],
      error: null,
    }),
    // maybeSingle -> the target list; awaiting the chain -> the source-stage lookup.
    lead_lists: table(
      {
        data: [
          { id: QUALIFIED, sort_order: 10, is_archive: false },
          { id: PROSPECTS, sort_order: 20, is_archive: false },
          { id: APPLICATIONS, sort_order: 30, is_archive: false, is_staging: false },
          { id: ENROLLED, sort_order: 40, is_archive: false, is_staging: false },
          { id: STAGING, sort_order: 99, is_archive: false, is_staging: true },
        ],
        error: null,
      },
      { data: { id: APPLICATIONS, slug: "applications", name: "Applications", is_archive: false, access: { mode: "all" }, pipeline_id: null, sort_order: 30 } },
    ),
  };
  createServiceClientMock.mockResolvedValue({ from: vi.fn((t: string) => tables[t] ?? table({ data: [], error: null })) });
  return tables;
}

describe("PATCH /api/v1/leads/bulk — Applications gate (fee + basic info + consent)", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset().mockResolvedValue(executive);
    createServiceClientMock.mockReset();
    readinessMock.mockReset();
  });

  it("forward move into Applications is blocked (422) when something is missing, naming what", async () => {
    setup(PROSPECTS);
    readinessMock.mockResolvedValue({ ready: false, missing: ["Processing fee", "Consent signed"] });
    const { PATCH } = await import("./route");
    const res = await PATCH(req({ ids: [LEAD], list_id: APPLICATIONS }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.details.applications[0]).toContain("Processing fee, Consent signed");
    expect(body.error.details.applications_failed_ids).toEqual([LEAD]);
    expect(body.error.details.applications_missing).toEqual(["Processing fee", "Consent signed"]);
  });

  it("an owner/admin is NOT exempt — no bypass for anyone", async () => {
    authenticateRequestMock.mockResolvedValue(admin);
    setup(PROSPECTS);
    readinessMock.mockResolvedValue({ ready: false, missing: ["Consent signed"] });
    const { PATCH } = await import("./route");
    expect((await PATCH(req({ ids: [LEAD], list_id: APPLICATIONS }))).status).toBe(422);
  });

  it("allowed when fee, basic info and consent are all done", async () => {
    const t = setup(PROSPECTS);
    readinessMock.mockResolvedValue({ ready: true, missing: [] });
    const { PATCH } = await import("./route");
    const res = await PATCH(req({ ids: [LEAD], list_id: APPLICATIONS }));
    expect(res.status).not.toBe(422);
    expect(t.leads.update).toHaveBeenCalled();
  });

  it("System Activity — a bulk stage move records who holds each lead (assignee unchanged)", async () => {
    auditMock.mockClear();
    setup(PROSPECTS);
    readinessMock.mockResolvedValue({ ready: true, missing: [] });
    const { PATCH } = await import("./route");
    await PATCH(req({ ids: [LEAD], list_id: APPLICATIONS }));
    const call = auditMock.mock.calls.find((c) => (c[0] as { changes?: { list?: unknown } }).changes?.list) as
      | [{ entityId: string; changes: Record<string, unknown> }]
      | undefined;
    expect(call).toBeTruthy();
    expect(call![0].entityId).toBe(LEAD);
    expect(call![0].changes.holder).toEqual({ old: null, new: "exec" }); // the lead's current assignee
    expect(call![0].changes.assigned_to).toBeUndefined();
  });

  it("a backward move into Applications (from a later stage) is not gated", async () => {
    setup(ENROLLED);
    readinessMock.mockResolvedValue({ ready: false, missing: ["Processing fee"] });
    const { PATCH } = await import("./route");
    const res = await PATCH(req({ ids: [LEAD], list_id: APPLICATIONS }));
    expect(res.status).not.toBe(422);
    expect(readinessMock).not.toHaveBeenCalled();
  });

  it("a lead already in Applications is not re-checked", async () => {
    setup(APPLICATIONS);
    readinessMock.mockResolvedValue({ ready: false, missing: ["Processing fee"] });
    const { PATCH } = await import("./route");
    const res = await PATCH(req({ ids: [LEAD], list_id: APPLICATIONS }));
    expect(res.status).not.toBe(422);
    expect(readinessMock).not.toHaveBeenCalled();
  });
});

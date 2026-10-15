import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

// Proves the bulk Prospects-qualification gate applies to FORWARD moves only:
// a revert (current stage sort_order > Prospects') is not blocked for a non-bypass member.

const authenticateRequestMock = vi.fn();
const createServiceClientMock = vi.fn();

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return { ...actual, authenticateRequest: authenticateRequestMock };
});
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: createServiceClientMock }));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: vi.fn().mockResolvedValue(undefined), emitEvent: vi.fn().mockResolvedValue(undefined) }));
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

const LEAD = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const PROSPECTS = "11111111-1111-1111-1111-111111111111";
const QUALIFIED = "22222222-2222-2222-2222-222222222222";
const APPLICATIONS = "33333333-3333-3333-3333-333333333333";

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
          { id: APPLICATIONS, sort_order: 30, is_archive: false },
        ],
        error: null,
      },
      { data: { id: PROSPECTS, slug: "prospects", name: "Prospects", is_archive: false, access: { mode: "all" }, pipeline_id: null, sort_order: 20 } },
    ),
  };
  createServiceClientMock.mockResolvedValue({ from: vi.fn((t: string) => tables[t] ?? table({ data: [], error: null })) });
  return tables;
}

describe("PATCH /api/v1/leads/bulk — Prospects qualification gate direction", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset().mockResolvedValue(executive);
    createServiceClientMock.mockReset();
  });

  it("forward move (Qualified -> Prospects) without a GPA is still blocked", async () => {
    setup(QUALIFIED);
    const { PATCH } = await import("./route");
    const res = await PATCH(req({ ids: [LEAD], list_id: PROSPECTS }));
    expect(res.status).toBe(422);
  });

  it("backward move (Applications -> Prospects) without a GPA is NOT blocked by the gate", async () => {
    const t = setup(APPLICATIONS);
    const { PATCH } = await import("./route");
    const res = await PATCH(req({ ids: [LEAD], list_id: PROSPECTS }));
    expect(res.status).not.toBe(422);
    expect(t.leads.update).toHaveBeenCalled();
  });
});

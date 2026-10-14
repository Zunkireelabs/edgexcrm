import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

// Admizz "Global" inbox: a bulk assign moves leads that are sitting in the default (Global) branch to
// the assignee's branch, and leaves leads already in another branch exactly where they are.
// Everything is a hand-rolled fake — no database.

const authenticateRequestMock = vi.fn();
const createServiceClientMock = vi.fn();
const syncOriginMembershipMock = vi.fn().mockResolvedValue(undefined);

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
vi.mock("@/lib/leads/branch-membership", () => ({ syncOriginMembership: syncOriginMembershipMock }));
vi.mock("@/lib/leads/collaborators", () => ({ addLeadCollaborators: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/leads/assign-display-ids", () => ({ assignDisplayIds: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/logger", () => ({ createRequestLogger: vi.fn(() => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() })) }));

const GLOBAL = "11111111-1111-1111-1111-111111111111";
const KTM = "22222222-2222-2222-2222-222222222222";
const BIRGUNJ = "33333333-3333-3333-3333-333333333333";
const IN_GLOBAL = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const IN_KTM = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
const ASSIGNEE = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";

const owner = {
  userId: "owner",
  tenantId: "tenant-1",
  role: "owner",
  industryId: "education_consultancy",
  branchId: null,
  branchMemberIds: [],
  entitlements: { maxBranches: 4 },
  permissions: { baseTier: "owner", leadScope: "all", canAssignLeads: true },
} as unknown as AuthContext;

const req = (body: unknown) => ({ json: async () => body, headers: { get: () => null } }) as unknown as NextRequest;

function table(result: { data?: unknown; error?: unknown }) {
  const o: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in", "not", "update", "insert", "upsert", "order", "limit", "neq", "or"]) o[m] = vi.fn(() => o);
  o.single = vi.fn(() => Promise.resolve(result));
  o.maybeSingle = vi.fn(() => Promise.resolve(result));
  o.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
  return o;
}

function setup(assigneeBranch: string | null) {
  const tables: Record<string, ReturnType<typeof table>> = {
    leads: table({
      data: [
        { id: IN_GLOBAL, assigned_to: null, branch_id: GLOBAL, list_id: null, status: "new" },
        { id: IN_KTM, assigned_to: null, branch_id: KTM, list_id: null, status: "new" },
      ],
      error: null,
    }),
    tenant_users: table({ data: { id: "tu", user_id: ASSIGNEE, branch_id: assigneeBranch, role: "staff" }, error: null }),
    branches: table({ data: { id: GLOBAL }, error: null }),
  };
  createServiceClientMock.mockResolvedValue({ from: vi.fn((t: string) => tables[t] ?? table({ data: [], error: null })) });
  return tables;
}

const branchMoves = (leads: ReturnType<typeof table>) =>
  (leads.update as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as Record<string, unknown>).filter((p) => "branch_id" in p);

describe("PATCH /api/v1/leads/bulk — Global leads move to the assignee's branch", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset().mockResolvedValue(owner);
    createServiceClientMock.mockReset();
    syncOriginMembershipMock.mockClear();
  });

  it("moves only the lead that was in Global; the KTM lead keeps KTM", async () => {
    const t = setup(BIRGUNJ);
    const { PATCH } = await import("./route");
    const res = await PATCH(req({ ids: [IN_GLOBAL, IN_KTM], assigned_to: ASSIGNEE }));
    expect(res.status).toBe(200);

    expect(branchMoves(t.leads)).toEqual([{ branch_id: BIRGUNJ }]);
    // …and only the Global lead's id was in that update.
    const inCalls = (t.leads.in as ReturnType<typeof vi.fn>).mock.calls;
    expect(inCalls).toContainEqual(["id", [IN_GLOBAL]]);

    // Origin rows follow: Global lead -> Birgunj, KTM lead untouched (still KTM).
    expect(syncOriginMembershipMock).toHaveBeenCalledWith(expect.anything(), "tenant-1", IN_GLOBAL, BIRGUNJ, ASSIGNEE);
    expect(syncOriginMembershipMock).toHaveBeenCalledWith(expect.anything(), "tenant-1", IN_KTM, KTM, ASSIGNEE);
  });

  it("an assignee with no branch (owner/admin) moves nothing", async () => {
    const t = setup(null);
    const { PATCH } = await import("./route");
    expect((await PATCH(req({ ids: [IN_GLOBAL], assigned_to: ASSIGNEE }))).status).toBe(200);
    expect(branchMoves(t.leads)).toEqual([]);
    expect(syncOriginMembershipMock).toHaveBeenCalledWith(expect.anything(), "tenant-1", IN_GLOBAL, GLOBAL, ASSIGNEE);
  });

  it("an explicit branch_id from the caller wins — no automatic move", async () => {
    const t = setup(BIRGUNJ);
    const { PATCH } = await import("./route");
    expect((await PATCH(req({ ids: [IN_GLOBAL], assigned_to: ASSIGNEE, branch_id: KTM }))).status).toBe(200);
    // Only the caller's own branch_id went through the normal bulk payload; no second "move" update.
    expect(branchMoves(t.leads).filter((p) => p.branch_id === BIRGUNJ)).toEqual([]);
  });

  it("unassigning (assigned_to: null) never moves a lead", async () => {
    const t = setup(BIRGUNJ);
    const { PATCH } = await import("./route");
    expect((await PATCH(req({ ids: [IN_GLOBAL], assigned_to: null }))).status).toBe(200);
    expect(branchMoves(t.leads)).toEqual([]);
  });

  it("if moving the leads to the new branch fails, NOTHING is assigned (503) — never assigned-but-still-in-Global", async () => {
    const t = setup(BIRGUNJ);
    // The branch-move update (the one carrying only branch_id) fails.
    (t.leads.update as ReturnType<typeof vi.fn>).mockImplementation((vals: Record<string, unknown>) =>
      "branch_id" in vals && !("assigned_to" in vals) ? table({ data: null, error: { message: "boom" } }) : table({ data: null, error: null }),
    );
    const { PATCH } = await import("./route");
    const res = await PATCH(req({ ids: [IN_GLOBAL], assigned_to: ASSIGNEE }));
    expect(res.status).toBe(503);
    const wroteAssignment = (t.leads.update as ReturnType<typeof vi.fn>).mock.calls.some((c) => "assigned_to" in (c[0] as object));
    expect(wroteAssignment).toBe(false);
    expect(syncOriginMembershipMock).not.toHaveBeenCalled();
  });
});

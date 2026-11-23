import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/industries/_shared/features/outreach/lib/stage-auto-enroll", () => ({
  onLeadsEnteredStageSafe: vi.fn(async () => ({ stopped: 0, runsCreated: 0, leadsQueued: 0 })),
}));
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

// EDGEX-127: PATCH /api/v1/leads/bulk { ids, add_tags } — union write, validation, and the SAME tenant/role/branch
// narrowing the route already runs for the selected ids.

const authenticateRequestMock = vi.fn();
const createServiceClientMock = vi.fn();
const createAuditLogMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return { ...actual, authenticateRequest: authenticateRequestMock };
});
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: createServiceClientMock }));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: createAuditLogMock, emitEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/notifications", () => ({
  createNotificationsExcept: vi.fn(),
  NotificationTypes: { LEAD_ASSIGNED: "lead.assigned", LEAD_UNASSIGNED: "lead.unassigned" },
}));
vi.mock("@/lib/email/send-lead-assigned", () => ({ sendBulkAssignedEmail: vi.fn() }));
vi.mock("@/lib/leads/branch-membership", () => ({ syncOriginMembership: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/leads/collaborators", () => ({ addLeadCollaborators: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/leads/assign-display-ids", () => ({ assignDisplayIds: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/logger", () => ({ createRequestLogger: vi.fn(() => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() })) }));

const BRANCH_A = "11111111-1111-1111-1111-111111111111";
const BRANCH_B = "22222222-2222-2222-2222-222222222222";
const L1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const L2 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
const L3 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3";

const admin = {
  userId: "admin-1",
  tenantId: "tenant-1",
  role: "admin",
  industryId: "education_consultancy",
  branchId: null,
  branchMemberIds: [],
  permissions: { baseTier: "admin", leadScope: "all" },
} as unknown as AuthContext;
const manager = {
  ...admin,
  userId: "mgr",
  role: "member",
  branchId: BRANCH_A,
  branchMemberIds: ["m1"],
  permissions: { baseTier: "member", leadScope: "team" },
} as unknown as AuthContext;
const counselor = { ...admin, userId: "cns", role: "member", permissions: { baseTier: "member", leadScope: "own" } } as unknown as AuthContext;

const req = (body: unknown) => ({ json: async () => body, headers: { get: () => null } }) as unknown as NextRequest;

type Row = { id: string; assigned_to: string | null; branch_id: string | null; list_id: string | null; status: string; tags: string[] };
const row = (id: string, tags: string[], branch_id: string | null = BRANCH_A): Row => ({ id, assigned_to: null, branch_id, list_id: null, status: "new", tags });

function setup(rows: Row[], opts: { failUpdateFor?: string[]; sharedIn?: string[] } = {}) {
  const updates: Array<{ id: string; payload: Record<string, unknown> }> = [];
  const selectEqCalls: unknown[][] = [];
  const chain = (result: unknown) => {
    const o: Record<string, unknown> = {};
    for (const m of ["select", "is", "in", "not", "order", "limit", "neq", "or"]) o[m] = vi.fn(() => o);
    o.eq = vi.fn((...a: unknown[]) => {
      selectEqCalls.push(a);
      return o;
    });
    o.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
    return o;
  };
  const leads = {
    ...chain({ data: rows, error: null }),
    update: vi.fn((payload: Record<string, unknown>) => {
      const u: Record<string, unknown> = {};
      let id = "";
      u.eq = vi.fn((col: string, val: string) => {
        if (col === "id") id = val;
        return u;
      });
      u.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        updates.push({ id, payload });
        return Promise.resolve({ error: opts.failUpdateFor?.includes(id) ? { message: "boom" } : null }).then(res, rej);
      };
      return u;
    }),
  };
  const tables: Record<string, unknown> = {
    leads,
    lead_branches: chain({ data: (opts.sharedIn ?? []).map((lead_id) => ({ lead_id })), error: null }),
  };
  createServiceClientMock.mockResolvedValue({ from: vi.fn((t: string) => tables[t] ?? chain({ data: [], error: null })) });
  return { updates, selectEqCalls, leads };
}

describe("PATCH /api/v1/leads/bulk — add_tags (EDGEX-127)", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset().mockResolvedValue(admin);
    createServiceClientMock.mockReset();
    createAuditLogMock.mockClear();
  });

  it("unions into each lead's tags, normalises, de-duplicates, skips leads that already have it, writes only tags + updated_at, and audits each change", async () => {
    const t = setup([row(L1, ["student"]), row(L2, ["scholarship-2027", "student"]), row(L3, [])]);
    const { PATCH } = await import("./route");
    const res = await PATCH(req({ ids: [L1, L2, L3], add_tags: ["Scholarship 2027", "scholarship-2027", "VIP"] }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ updated: 3, failed: 0, add_tags: ["scholarship-2027", "vip"] });
    const byId = Object.fromEntries(t.updates.map((u) => [u.id, u.payload]));
    expect(byId[L1]).toMatchObject({ tags: ["student", "scholarship-2027", "vip"] });
    expect(byId[L2]).toMatchObject({ tags: ["scholarship-2027", "student", "vip"] }); // existing kept, only vip added
    expect(byId[L3]).toMatchObject({ tags: ["scholarship-2027", "vip"] });
    for (const u of t.updates) expect(Object.keys(u.payload).sort()).toEqual(["tags", "updated_at"]);
    expect(createAuditLogMock).toHaveBeenCalledTimes(3);
    expect(createAuditLogMock.mock.calls[0][0]).toMatchObject({ action: "lead.updated", changes: { tags: expect.anything() } });
  });

  it("a lead that already carries every tag is not rewritten", async () => {
    const t = setup([row(L1, ["vip"])]);
    const { PATCH } = await import("./route");
    const res = await PATCH(req({ ids: [L1], add_tags: ["VIP"] }));
    expect(res.status).toBe(200);
    expect(t.updates).toHaveLength(0);
  });

  it.each([
    ["empty array", { add_tags: [] }],
    ["more than 10 tags", { add_tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }],
    ["a tag over 50 chars", { add_tags: ["a".repeat(51)] }],
    ["a tag that normalises to nothing", { add_tags: ["!!!"] }],
    ["a non-string tag", { add_tags: [5] }],
    ["combined with another field", { add_tags: ["x"], assigned_to: "dddddddd-dddd-dddd-dddd-ddddddddddd1" }],
  ])("rejects %s with 422 and writes nothing", async (_label, extra) => {
    const t = setup([row(L1, [])]);
    const { PATCH } = await import("./route");
    const res = await PATCH(req({ ids: [L1], ...extra }));
    expect(res.status).toBe(422);
    expect(t.updates).toHaveLength(0);
  });

  it("a branch manager cannot tag a lead outside their branch (same narrowing as assign) — 422, nothing written", async () => {
    authenticateRequestMock.mockResolvedValue(manager);
    const t = setup([row(L1, [], BRANCH_B)]);
    const { PATCH } = await import("./route");
    const res = await PATCH(req({ ids: [L1], add_tags: ["x"] }));
    expect(res.status).toBe(422);
    expect(t.updates).toHaveLength(0);
  });

  it("a branch manager CAN tag leads in their branch and ones shared in, and only those in a mixed selection", async () => {
    authenticateRequestMock.mockResolvedValue(manager);
    const t = setup([row(L1, [], BRANCH_A), row(L2, [], BRANCH_B), row(L3, [], BRANCH_B)], { sharedIn: [L3] });
    const { PATCH } = await import("./route");
    const res = await PATCH(req({ ids: [L1, L2, L3], add_tags: ["x"] }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(t.updates.map((u) => u.id).sort()).toEqual([L1, L3]);
    expect(body.data.updated).toBe(2);
  });

  it("is tenant-scoped: the lead lookup and every write carry the caller's tenant_id, so a foreign-tenant id resolves to 'not found' (422)", async () => {
    const t = setup([]); // the tenant-scoped lookup finds nothing for a foreign id
    const { PATCH } = await import("./route");
    const res = await PATCH(req({ ids: [L1], add_tags: ["x"] }));
    expect(res.status).toBe(422);
    expect(t.selectEqCalls).toContainEqual(["tenant_id", "tenant-1"]);
    expect(t.updates).toHaveLength(0);
  });

  it("a counselor (own scope) is forbidden outright", async () => {
    authenticateRequestMock.mockResolvedValue(counselor);
    const t = setup([row(L1, [])]);
    const { PATCH } = await import("./route");
    expect((await PATCH(req({ ids: [L1], add_tags: ["x"] }))).status).toBe(403);
    expect(t.updates).toHaveLength(0);
  });

  it("partial failure is reported, not hidden: failed count in the response, audit only for the writes that landed", async () => {
    const t = setup([row(L1, []), row(L2, [])], { failUpdateFor: [L2] });
    const { PATCH } = await import("./route");
    const res = await PATCH(req({ ids: [L1, L2], add_tags: ["x"] }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ updated: 1, failed: 1, ids: [L1] });
    expect(t.updates).toHaveLength(2);
    expect(createAuditLogMock).toHaveBeenCalledTimes(1);
  });
});

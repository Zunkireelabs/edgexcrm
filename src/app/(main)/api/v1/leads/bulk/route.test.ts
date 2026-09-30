import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

// Wiring test for the ONE thing this file proves: a bulk assign by a branch manager now reaches
// leads that another branch SHARED IN to their branch (lead_branches rows), and can pick an admin.
// Everything after the scope gate is mocked to a no-op success — it is not under test here.

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
vi.mock("@/lib/logger", () => ({ createRequestLogger: vi.fn(() => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() })) }));

const RECEIVING = "22222222-2222-2222-2222-222222222222";
const ORIGIN = "11111111-1111-1111-1111-111111111111";
const LEAD = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const MEMBER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";
const ADMIN = "cccccccc-cccc-cccc-cccc-ccccccccccc1";

const manager = {
  userId: "mgr",
  tenantId: "tenant-1",
  role: "member",
  industryId: "education_consultancy",
  branchId: RECEIVING,
  branchMemberIds: [MEMBER],
  entitlements: { maxBranches: 3 },
  permissions: { baseTier: "member", leadScope: "team", canAssignLeads: true },
} as unknown as AuthContext;

const req = (body: unknown) => ({ json: async () => body, headers: { get: () => null } }) as unknown as NextRequest;

// Thenable chain: every builder method returns itself; awaiting resolves `result`.
function table(result: { data?: unknown; error?: unknown }) {
  const o: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in", "not", "update", "insert", "upsert", "order", "limit", "neq", "or"]) o[m] = vi.fn(() => o);
  o.single = vi.fn(() => Promise.resolve(result));
  o.maybeSingle = vi.fn(() => Promise.resolve(result));
  o.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
  return o;
}

function setup(opts: { sharedInLeadIds: string[]; target: { id: string; branch_id: string | null; role: string } }) {
  const tables: Record<string, ReturnType<typeof table>> = {
    // The lead belongs to ORIGIN, is assigned to nobody in the receiving branch.
    leads: table({ data: [{ id: LEAD, assigned_to: null, branch_id: ORIGIN, list_id: null, status: "new" }], error: null }),
    lead_branches: table({ data: opts.sharedInLeadIds.map((lead_id) => ({ lead_id })), error: null }),
    tenant_users: table({ data: opts.target, error: null }),
  };
  createServiceClientMock.mockResolvedValue({ from: vi.fn((t: string) => tables[t] ?? table({ data: [], error: null })) });
  return tables;
}

describe("PATCH /api/v1/leads/bulk — branch manager scope", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset().mockResolvedValue(manager);
    createServiceClientMock.mockReset();
  });

  it("a lead SHARED IN to the manager's branch is included in a bulk assign (was silently dropped: 'No valid leads found to update')", async () => {
    const t = setup({ sharedInLeadIds: [LEAD], target: { id: "tu", branch_id: RECEIVING, role: "staff" } });
    const { PATCH } = await import("./route");
    const res = await PATCH(req({ ids: [LEAD], assigned_to: MEMBER }));
    expect(res.status).not.toBe(422);
    expect(res.status).toBe(200);
    // The assignment update really was issued for the shared-in lead.
    expect(t.leads.update).toHaveBeenCalled();
  });

  it("a lead NOT in the manager's branch (not shared in, not theirs) is still excluded — 422, nothing updated", async () => {
    const t = setup({ sharedInLeadIds: [], target: { id: "tu", branch_id: RECEIVING, role: "staff" } });
    const { PATCH } = await import("./route");
    const res = await PATCH(req({ ids: [LEAD], assigned_to: MEMBER }));
    expect(res.status).toBe(422);
    expect(t.leads.update).not.toHaveBeenCalled();
  });

  it("the manager may bulk-assign to an admin who has no branch (education) — same as the single-lead PATCH", async () => {
    setup({ sharedInLeadIds: [LEAD], target: { id: "tu", branch_id: null, role: "admin" } });
    const { PATCH } = await import("./route");
    expect((await PATCH(req({ ids: [LEAD], assigned_to: ADMIN }))).status).toBe(200);
  });

  it("but not to a non-admin from another branch — still forbidden", async () => {
    setup({ sharedInLeadIds: [LEAD], target: { id: "tu", branch_id: ORIGIN, role: "staff" } });
    const { PATCH } = await import("./route");
    expect((await PATCH(req({ ids: [LEAD], assigned_to: MEMBER }))).status).toBe(403);
  });

  it("the admin exemption is education-only: outside education a branchless admin is still refused", async () => {
    authenticateRequestMock.mockResolvedValue({ ...manager, industryId: "it_agency" });
    setup({ sharedInLeadIds: [LEAD], target: { id: "tu", branch_id: null, role: "admin" } });
    const { PATCH } = await import("./route");
    expect((await PATCH(req({ ids: [LEAD], assigned_to: ADMIN }))).status).toBe(403);
  });
});

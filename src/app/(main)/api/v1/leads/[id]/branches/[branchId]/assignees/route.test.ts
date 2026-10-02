import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

const authenticateRequestMock = vi.fn();
const getLeadMembershipMock = vi.fn();
const createServiceClientMock = vi.fn();
const getTeamMembersMock = vi.fn();

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: authenticateRequestMock }));
vi.mock("@/lib/leads/branch-membership", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/leads/branch-membership")>();
  return { ...actual, getLeadMembership: getLeadMembershipMock };
});
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: createServiceClientMock }));
vi.mock("@/lib/supabase/queries", () => ({ getTeamMembers: getTeamMembersMock }));

const RECEIVING = "22222222-2222-2222-2222-222222222222";
const ORIGIN = "11111111-1111-1111-1111-111111111111";
const OTHER = "33333333-3333-3333-3333-333333333333";

function chain(result: { data?: unknown; error?: unknown }) {
  const obj: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is"]) obj[m] = vi.fn(() => obj);
  obj.single = vi.fn(() => Promise.resolve(result));
  return obj;
}
const params = (branchId = RECEIVING) => Promise.resolve({ id: "lead-1", branchId });
const req = {} as NextRequest;

const TEAM = [
  { user_id: "u-recv", name: "Rita", email: "rita@x.com", branch_id: RECEIVING, role: "staff" },
  { user_id: "u-orig", name: "Om", email: "om@x.com", branch_id: ORIGIN, role: "staff" },
  { user_id: "u-admin", name: "Ann", email: "ann@x.com", branch_id: null, role: "admin" },
  { user_id: "u-none", name: "Nia", email: "nia@x.com", branch_id: null, role: "staff" },
];

const auth = (over: Record<string, unknown> = {}) =>
  ({
    userId: "caller",
    tenantId: "tenant-1",
    role: "owner",
    industryId: "education_consultancy",
    branchId: null,
    entitlements: { maxBranches: 3 },
    permissions: { baseTier: "owner", leadScope: "all" },
    ...over,
  }) as unknown as AuthContext;

const MANAGER = { role: "member", branchId: RECEIVING, permissions: { baseTier: "member", leadScope: "team" } };

describe("GET /api/v1/leads/[id]/branches/[branchId]/assignees", () => {
  beforeEach(() => {
    for (const m of [authenticateRequestMock, getLeadMembershipMock, createServiceClientMock, getTeamMembersMock]) m.mockReset();
    authenticateRequestMock.mockResolvedValue(auth());
    // The lead was shared from ORIGIN into RECEIVING.
    getLeadMembershipMock.mockResolvedValue([
      { branch_id: ORIGIN, assigned_to: "u-orig", is_origin: true },
      { branch_id: RECEIVING, assigned_to: null, is_origin: false },
    ]);
    getTeamMembersMock.mockResolvedValue(TEAM);
    createServiceClientMock.mockResolvedValue({
      from: (t: string) => (t === "leads" ? chain({ data: { id: "lead-1" } }) : chain({ data: { id: RECEIVING } })),
    });
  });

  it("401 when unauthenticated; 403 on a single-branch plan", async () => {
    const { GET } = await import("./route");
    authenticateRequestMock.mockResolvedValue(null);
    expect((await GET(req, { params: params() })).status).toBe(401);
    authenticateRequestMock.mockResolvedValue(auth({ entitlements: { maxBranches: 1 } }));
    expect((await GET(req, { params: params() })).status).toBe(403);
  });

  it("an admin gets the branch's members PLUS admins (who have no branch) — never an empty list", async () => {
    const { GET } = await import("./route");
    const res = await GET(req, { params: params() });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.assignees.map((a: { user_id: string }) => a.user_id)).toEqual(["u-recv", "u-admin"]);
    expect(body.data.assignees.find((a: { user_id: string }) => a.user_id === "u-admin").is_admin_exempt).toBe(true);
    expect(body.data.assignees.find((a: { user_id: string }) => a.user_id === "u-recv").is_admin_exempt).toBe(false);
  });

  it("the RECEIVING branch's manager gets the list even though they can't read /api/v1/team", async () => {
    authenticateRequestMock.mockResolvedValue(auth(MANAGER));
    const { GET } = await import("./route");
    const res = await GET(req, { params: params() });
    expect(res.status).toBe(200);
    expect((await res.json()).data.assignees.map((a: { user_id: string }) => a.user_id)).toContain("u-recv");
  });

  it("a manager is refused on ANOTHER branch's row (same rule as the PATCH)", async () => {
    authenticateRequestMock.mockResolvedValue(auth(MANAGER));
    const { GET } = await import("./route");
    expect((await GET(req, { params: params(ORIGIN) })).status).toBe(403);
  });

  it("a manager whose branch does NOT hold the lead is refused for a branch it isn't in", async () => {
    authenticateRequestMock.mockResolvedValue(auth({ ...MANAGER, branchId: OTHER }));
    const { GET } = await import("./route");
    expect((await GET(req, { params: params(RECEIVING) })).status).toBe(403);
  });

  it("a branch the lead is NOT yet in (share dialog): a manager whose branch holds the lead may list candidates", async () => {
    authenticateRequestMock.mockResolvedValue(auth({ ...MANAGER, branchId: ORIGIN }));
    const { GET } = await import("./route");
    const res = await GET(req, { params: params(OTHER) });
    expect(res.status).toBe(200);
  });

  it("outside education the admin exemption is off — only the branch's own members are listed", async () => {
    authenticateRequestMock.mockResolvedValue(auth({ industryId: "it_agency" }));
    const { GET } = await import("./route");
    const body = await (await GET(req, { params: params() })).json();
    expect(body.data.assignees.map((a: { user_id: string }) => a.user_id)).toEqual(["u-recv"]);
  });

  it("a counselor is refused", async () => {
    authenticateRequestMock.mockResolvedValue(auth({ role: "staff", branchId: RECEIVING, permissions: { baseTier: "member", leadScope: "own" } }));
    const { GET } = await import("./route");
    expect((await GET(req, { params: params() })).status).toBe(403);
  });

  it("422 on a malformed branch id, 404 when the lead doesn't exist", async () => {
    const { GET } = await import("./route");
    expect((await GET(req, { params: params("not-a-uuid") })).status).toBe(422);
    createServiceClientMock.mockResolvedValue({ from: () => chain({ data: null }) });
    expect((await GET(req, { params: params() })).status).toBe(404);
  });
});

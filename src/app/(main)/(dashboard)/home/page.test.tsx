import { beforeEach, describe, expect, it, vi } from "vitest";

const tenantRef = vi.hoisted(() => ({ industry: "it_agency" }));
const HomeContentStub = vi.hoisted(() => () => null);
const EducationHomeStub = vi.hoisted(() => () => null);
const loadHomeMock = vi.hoisted(() => vi.fn(async () => ({ stub: true })));
const ManagerHomeStub = vi.hoisted(() => () => null);
const loadManagerMock = vi.hoisted(() => vi.fn(async () => ({ stub: "manager" })));
const scopeRef = vi.hoisted(() => ({ mode: "own" as "own" | "manager" }));

vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
vi.mock("@/lib/supabase/server", () => ({
  getCachedUser: async () => ({ id: "u1", email: "rita@example.com", user_metadata: { name: "Rita Karki" } }),
  createServiceClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "tu1" } }) }) }) }) }),
  }),
}));
vi.mock("@/lib/supabase/queries", () => ({
  getCurrentUserTenant: async () => ({
    tenant: { id: "t1", industry_id: tenantRef.industry, timezone: "Asia/Kathmandu", config: null },
    userId: "u1",
    permissions: {},
  }),
  getLeads: async () => [],
  getMySchedule: async () => [],
  getMyTasks: async () => ({ open: [], done: [] }),
  getMyActiveTimers: async () => ({}),
  getMyInboxSnapshot: async () => ({ unreadCount: 0 }),
  getMyRecentActivity: async () => [],
  getLeaveForHome: async () => null,
  getOutreachDueForHome: async () => 0,
  getBranches: async () => [],
}));
vi.mock("@/lib/api/permissions", () => ({ canManageHR: () => false }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/industries/education-consultancy/features/home/lib/scope", () => ({
  resolveHomeScope: () => (scopeRef.mode === "own" ? { mode: "own" } : { mode: "manager", branchId: null, pinned: false }),
}));
vi.mock("@/industries/education-consultancy/features/home/ui/manager-home", () => ({ ManagerHome: ManagerHomeStub }));
vi.mock("@/industries/education-consultancy/features/home/server/load-manager", () => ({ loadManagerHome: loadManagerMock }));
vi.mock("@/lib/api/auth", () => ({ authenticateRequest: async () => ({ userId: "u1", tenantId: "t1", industryId: tenantRef.industry }) }));
vi.mock("@/components/dashboard/home/home-content", () => ({ HomeContent: HomeContentStub }));
vi.mock("@/industries/education-consultancy/features/home/ui/home-page", () => ({ EducationHome: EducationHomeStub }));
vi.mock("@/industries/education-consultancy/features/home/server/load-page", () => ({ loadHome: loadHomeMock }));

beforeEach(() => { loadHomeMock.mockClear(); loadManagerMock.mockClear(); scopeRef.mode = "own"; });

describe("Home page chooses the Home by industry", () => {
  it("education tenants get the new Do-next Home, loaded with the first name", async () => {
    tenantRef.industry = "education_consultancy";
    const { default: HomePage } = await import("./page");
    const el = (await HomePage()) as { type: unknown };
    expect(el.type).toBe(EducationHomeStub);
    expect(loadHomeMock).toHaveBeenCalledTimes(1);
    expect((loadHomeMock.mock.calls[0] as unknown[])[2]).toBe("Rita");
  });

  it("an education owner or manager gets the Needs-you Home, with their own to-dos loaded inside it", async () => {
    tenantRef.industry = "education_consultancy";
    scopeRef.mode = "manager";
    const { default: HomePage } = await import("./page");
    const el = (await HomePage()) as { type: unknown };
    expect(el.type).toBe(ManagerHomeStub);
    expect(loadManagerMock).toHaveBeenCalledTimes(1);
    expect(loadHomeMock).not.toHaveBeenCalled();
  });

  it("every other industry keeps today's HomeContent and never loads the education data", async () => {
    tenantRef.industry = "it_agency";
    const { default: HomePage } = await import("./page");
    const el = (await HomePage()) as { type: unknown };
    expect(el.type).toBe(HomeContentStub);
    expect(loadHomeMock).not.toHaveBeenCalled();
  });
});

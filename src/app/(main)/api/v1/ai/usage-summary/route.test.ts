import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthContext } from "@/lib/api/auth";

const authenticateRequestMock = vi.fn();
const isAssistantEnabledForTenantMock = vi.fn();
const checkDailyBudgetMock = vi.fn();
const scopedClientMock = vi.fn();

vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: authenticateRequestMock,
  requireAdmin: (a: { role?: string }) => a?.role === "owner" || a?.role === "admin",
}));
vi.mock("@/lib/ai/flag", () => ({ isAssistantEnabledForTenant: isAssistantEnabledForTenantMock }));
vi.mock("@/lib/ai/budget", () => ({ checkDailyBudget: checkDailyBudgetMock }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: scopedClientMock }));

const AUTH = { userId: "u1", tenantId: "t1", role: "owner" } as unknown as AuthContext;

function fakeDb(result: { count: number | null; error: unknown }, calls: Array<[string, unknown]> = []) {
  const builder: Record<string, unknown> = {};
  builder.eq = (c: string, v: unknown) => (calls.push([c, v]), builder);
  builder.gte = async (c: string, v: unknown) => (calls.push([c, v]), result);
  return { from: () => ({ select: (_c: string, opts: unknown) => (calls.push(["select-opts", opts]), builder) }) };
}

describe("GET /api/v1/ai/usage-summary", () => {
  beforeEach(() => {
    for (const m of [authenticateRequestMock, isAssistantEnabledForTenantMock, checkDailyBudgetMock, scopedClientMock]) m.mockReset();
  });

  it("401s when unauthenticated", async () => {
    authenticateRequestMock.mockResolvedValue(null);
    const { GET } = await import("./route");
    expect((await GET()).status).toBe(401);
  });

  it.each(["counselor", "viewer"])("403s for a %s", async (role) => {
    authenticateRequestMock.mockResolvedValue({ ...AUTH, role });
    const { GET } = await import("./route");
    expect((await GET()).status).toBe(403);
    expect(scopedClientMock).not.toHaveBeenCalled();
  });

  it("returns { enabled: false } when AI is off for the workspace", async () => {
    authenticateRequestMock.mockResolvedValue(AUTH);
    isAssistantEnabledForTenantMock.mockResolvedValue(false);
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ enabled: false });
    expect(scopedClientMock).not.toHaveBeenCalled();
  });

  it("returns the daily budget and this month's request count (admin allowed)", async () => {
    authenticateRequestMock.mockResolvedValue({ ...AUTH, role: "admin" });
    isAssistantEnabledForTenantMock.mockResolvedValue(true);
    checkDailyBudgetMock.mockResolvedValue({ overBudget: false, usedToday: 6000, limit: 200000 });
    const calls: Array<[string, unknown]> = [];
    scopedClientMock.mockResolvedValue(fakeDb({ count: 1284, error: null }, calls));
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ enabled: true, usedToday: 6000, dailyLimit: 200000, requestsThisMonth: 1284 });
    expect(calls).toContainEqual(["surface", "assistant"]);
    expect(calls).toContainEqual(["select-opts", { count: "exact", head: true }]);
    const gte = calls.find(([c]) => c === "created_at");
    expect(new Date(gte![1] as string).getUTCDate()).toBe(1);
  });

  it("503s when the monthly count fails", async () => {
    authenticateRequestMock.mockResolvedValue(AUTH);
    isAssistantEnabledForTenantMock.mockResolvedValue(true);
    checkDailyBudgetMock.mockResolvedValue({ overBudget: false, usedToday: 0, limit: 1 });
    scopedClientMock.mockResolvedValue(fakeDb({ count: null, error: { message: "x" } }));
    const { GET } = await import("./route");
    expect((await GET()).status).toBe(503);
  });
});

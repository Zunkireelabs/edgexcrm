import { beforeEach, describe, expect, it, vi } from "vitest";

const authRef = vi.hoisted(() => ({ value: null as unknown }));
const scopeRef = vi.hoisted(() => ({ value: { mode: "manager", branchId: null, pinned: false } as unknown }));
const countMock = vi.hoisted(() => vi.fn(async () => 100));
const clearMock = vi.hoisted(() => vi.fn(async () => ({ cleared: 100, failed: 0, remaining: 0 })));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/api/auth", () => ({ authenticateRequest: async () => authRef.value }));
vi.mock("@/lib/supabase/queries", () => ({ getBranches: async () => [] }));
vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: async () => ({ raw: () => ({ from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { timezone: "Asia/Kathmandu" } }) }) }) }) }) }),
}));
vi.mock("@/industries/education-consultancy/features/home/lib/scope", () => ({ resolveHomeScope: () => scopeRef.value }));
vi.mock("@/industries/education-consultancy/features/home/server/stale-callbacks", () => ({ countStaleCallbacks: countMock, clearStaleCallbacks: clearMock }));

const req = (body: unknown) => new Request("http://x/api/v1/home/clear-stale-callbacks", { method: "POST", body: JSON.stringify(body) }) as never;
const edu = { userId: "m", tenantId: "t", industryId: "education_consultancy", permissions: {}, branchId: null };

beforeEach(() => {
  authRef.value = edu;
  scopeRef.value = { mode: "manager", branchId: null, pinned: false };
  countMock.mockClear().mockResolvedValue(100);
  clearMock.mockClear();
});

describe("POST /api/v1/home/clear-stale-callbacks", () => {
  it("401 without a session", async () => {
    authRef.value = null;
    const { POST } = await import("./route");
    expect((await POST(req({ expected_count: 100 }))).status).toBe(401);
  });
  it("403 for a tenant outside the education Home (feature gate)", async () => {
    authRef.value = { ...edu, industryId: "it_agency" };
    const { POST } = await import("./route");
    expect((await POST(req({ expected_count: 100 }))).status).toBe(403);
    expect(clearMock).not.toHaveBeenCalled();
  });
  it("403 for own-scope people (they see only their own leads)", async () => {
    scopeRef.value = { mode: "own" };
    const { POST } = await import("./route");
    expect((await POST(req({ expected_count: 100 }))).status).toBe(403);
    expect(clearMock).not.toHaveBeenCalled();
  });
  it("422 without a confirmed count; ids from the client are never read", async () => {
    const { POST } = await import("./route");
    expect((await POST(req({}))).status).toBe(422);
    expect((await POST(req({ expected_count: "100", ids: ["x"] }))).status).toBe(422);
  });
  it("409 with the new count when the server's count differs by more than 10%", async () => {
    countMock.mockResolvedValue(140);
    const { POST } = await import("./route");
    const res = await POST(req({ expected_count: 100 }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.details.count).toBe(140);
    expect(clearMock).not.toHaveBeenCalled();
  });
  it("clears and returns {cleared, failed, remaining} when the count matches", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ expected_count: 100 }));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ cleared: 100, failed: 0, remaining: 0 });
    expect(clearMock).toHaveBeenCalledTimes(1);
  });
});

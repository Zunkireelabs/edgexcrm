import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthContext } from "@/lib/api/auth";
import { clearTagsCacheForTenant } from "@/lib/leads/tags-cache";

const authenticateRequestMock = vi.fn();
const scopedClientMock = vi.fn();
vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return { ...actual, authenticateRequest: authenticateRequestMock };
});
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: scopedClientMock }));
vi.mock("@/lib/logger", () => ({ createRequestLogger: vi.fn(() => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() })) }));

const admin = { userId: "a", tenantId: "t1", role: "admin", branchId: null, branchMemberIds: [], permissions: { baseTier: "admin", leadScope: "all" } } as unknown as AuthContext;
const manager = { ...admin, role: "member", branchId: "b1", branchMemberIds: ["m1", "m2"], permissions: { baseTier: "member", leadScope: "team" } } as unknown as AuthContext;
const counselor = { ...admin, role: "member", permissions: { baseTier: "member", leadScope: "own" } } as unknown as AuthContext;

// scopedClient double: records filter calls, serves pages of rows by .range().
function db(pages: Array<Array<{ tags: string[] }>>) {
  const calls: unknown[][] = [];
  let ranges = 0;
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "is", "not", "neq", "order", "or", "eq"]) chain[m] = (...a: unknown[]) => (calls.push([m, ...a]), chain);
  chain.range = () => Promise.resolve({ data: pages[ranges++] ?? [], error: null });
  return { client: { from: () => chain }, calls, ranges: () => ranges };
}
const rows = (n: number, tags: string[]) => Array.from({ length: n }, () => ({ tags }));

describe("GET /api/v1/leads/tags (EDGEX-127)", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset().mockResolvedValue(admin);
    scopedClientMock.mockReset();
    clearTagsCacheForTenant("t1");
  });

  it("returns distinct tags with lead counts, biggest first, counting a lead once per tag", async () => {
    const d = db([[{ tags: ["student", "vip"] }, { tags: ["student", "Student"] }, { tags: ["vip"] }, { tags: ["vip", "late"] }]]);
    scopedClientMock.mockResolvedValue(d.client);
    const { GET } = await import("./route");
    const body = (await (await GET()).json()).data;
    expect(body).toEqual({ tags: [{ tag: "vip", count: 3 }, { tag: "student", count: 2 }, { tag: "late", count: 1 }], truncated: false });
  });

  it("pages in 1000-row chunks until a short page, and only reads tagged, live leads through the tenant-scoped client", async () => {
    const d = db([rows(1000, ["a"]), rows(1000, ["a"]), rows(5, ["a"])]);
    scopedClientMock.mockResolvedValue(d.client);
    const { GET } = await import("./route");
    const body = (await (await GET()).json()).data;
    expect(d.ranges()).toBe(3);
    expect(body.tags).toEqual([{ tag: "a", count: 2005 }]);
    expect(JSON.stringify(d.calls)).toContain('"deleted_at"');
    expect(JSON.stringify(d.calls)).toContain('"tags"');
    expect(scopedClientMock).toHaveBeenCalledWith(admin); // tenant filter comes from the scoped client, never a param
  });

  it("over 20 pages it ships names without counts (never a partial count)", async () => {
    const d = db(Array.from({ length: 25 }, () => rows(1000, ["a"])));
    scopedClientMock.mockResolvedValue(d.client);
    const { GET } = await import("./route");
    const body = (await (await GET()).json()).data;
    expect(d.ranges()).toBe(20);
    expect(body).toEqual({ tags: [{ tag: "a", count: null }], truncated: true });
  });

  it("a branch manager is limited to their branch / its members; an admin is not narrowed", async () => {
    authenticateRequestMock.mockResolvedValue(manager);
    const d = db([[{ tags: ["x"] }]]);
    scopedClientMock.mockResolvedValue(d.client);
    const { GET } = await import("./route");
    await GET();
    const or = d.calls.find((c) => c[0] === "or");
    expect(String(or?.[1])).toContain("branch_id.eq.b1");
    expect(String(or?.[1])).toContain("m1,m2");
    clearTagsCacheForTenant("t1");
    authenticateRequestMock.mockResolvedValue(admin);
    const d2 = db([[{ tags: ["x"] }]]);
    scopedClientMock.mockResolvedValue(d2.client);
    await GET();
    expect(d2.calls.find((c) => c[0] === "or")).toBeUndefined();
  });

  it("a counselor (own scope) is forbidden; unauthenticated is 401; a branch-less team user is forbidden", async () => {
    const { GET } = await import("./route");
    authenticateRequestMock.mockResolvedValue(counselor);
    expect((await GET()).status).toBe(403);
    authenticateRequestMock.mockResolvedValue({ ...manager, branchId: null });
    expect((await GET()).status).toBe(403);
    authenticateRequestMock.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(scopedClientMock).not.toHaveBeenCalled();
  });

  it("is cached per tenant+scope for 60 s (second call makes no query) and the cache is tenant-keyed", async () => {
    const d = db([[{ tags: ["x"] }]]);
    scopedClientMock.mockResolvedValue(d.client);
    const { GET } = await import("./route");
    await GET();
    await GET();
    expect(scopedClientMock).toHaveBeenCalledTimes(1);
    authenticateRequestMock.mockResolvedValue({ ...admin, tenantId: "t2" });
    const d2 = db([[{ tags: ["y"] }]]);
    scopedClientMock.mockResolvedValue(d2.client);
    const body = (await (await GET()).json()).data;
    expect(body.tags).toEqual([{ tag: "y", count: 1 }]);
    clearTagsCacheForTenant("t2");
  });
});

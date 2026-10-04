import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/v1/outreach/drafts — with `page` it is a page + a true total (the Today list stays fast and honest with
// thousands of drafts); without it the old "everything" shape; lead_id narrows to one lead; only real uuids are filters.

const authMock = vi.fn();
const featureMock = vi.fn();
let scopeCall: { filters: Record<string, unknown>; select: unknown; opts: unknown } | null;
let ops: Array<[string, ...unknown[]]>;
let result: { data: unknown[]; error: { message: string } | null; count: number | null };

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: () => authMock() }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: (...a: unknown[]) => featureMock(...a) }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: async () => ({}) }));
vi.mock("@/industries/_shared/features/outreach/lib/draft-scope", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/industries/_shared/features/outreach/lib/draft-scope")>();
  return {
    ...actual,
    buildDraftsQuery: (_db: unknown, _auth: unknown, filters: Record<string, unknown>, select: unknown, opts: unknown) => {
      scopeCall = { filters, select, opts };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        order(...a: unknown[]) { ops.push(["order", ...a]); return b; },
        range(...a: unknown[]) { ops.push(["range", ...a]); return b; },
        then(resolve: (v: unknown) => void) { resolve(result); },
      };
      return b;
    },
  };
});

import { GET } from "./route";
import type { NextRequest } from "next/server";

const U = "3168f9d7-23c7-48c1-a29b-3b9a94b3512f";
const get = (qs = "") => GET({ url: `http://x/api/v1/outreach/drafts${qs}` } as unknown as NextRequest);

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ userId: "u1", role: "admin", industryId: "education_consultancy" });
  featureMock.mockReset().mockReturnValue(true);
  scopeCall = null;
  ops = [];
  result = { data: [{ id: "d1" }], error: null, count: 1234 };
});

describe("GET outreach drafts", () => {
  it("401 signed out, 403 without Outreach", async () => {
    authMock.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    authMock.mockResolvedValue({ userId: "u1", role: "admin", industryId: "x" });
    featureMock.mockReturnValue(false);
    expect((await get()).status).toBe(403);
  });

  it("with `page`: returns that page and the TRUE total, ordered by due_at then id so a draft never straddles pages", async () => {
    const res = await get("?due=today&page=3&pageSize=50");
    const json = (await res.json()) as { data: unknown[]; meta: Record<string, number> };

    expect(res.status).toBe(200);
    expect(json.meta).toEqual({ page: 3, pageSize: 50, total: 1234, totalPages: 25 });
    expect(scopeCall!.opts).toEqual({ count: "exact" });
    expect(scopeCall!.filters).toMatchObject({ due: "today" });
    expect(ops).toEqual([["order", "due_at", { ascending: true }], ["order", "id", { ascending: true }], ["range", 100, 149]]);
  });

  it("page size is capped at 100 and a bad page falls back to 1", async () => {
    const json = (await (await get("?page=banana&pageSize=5000")).json()) as { meta: Record<string, number> };
    expect(json.meta).toMatchObject({ page: 1, pageSize: 100 });
    expect(ops.at(-1)).toEqual(["range", 0, 99]);
  });

  it("an empty list is page 1 of 1, not page 1 of 0", async () => {
    result = { data: [], error: null, count: 0 };
    expect(((await (await get("?page=1")).json()) as { meta: Record<string, number> }).meta).toMatchObject({ total: 0, totalPages: 1 });
  });

  it("without `page`: the old shape — a plain list, no count", async () => {
    const json = (await (await get("?due=all")).json()) as { data: unknown[]; meta?: unknown };
    expect(json.data).toEqual([{ id: "d1" }]);
    expect(json.meta).toBeUndefined();
    expect(scopeCall!.opts).toBeUndefined();
    expect(ops).toEqual([["order", "due_at", { ascending: true }]]);
  });

  it("lead_id narrows to one lead; a non-uuid lead_id / assigned_to is ignored, never used as a filter", async () => {
    await get(`?lead_id=${U}&assigned_to=${U}`);
    expect(scopeCall!.filters).toMatchObject({ leadId: U, assignedTo: U });
    await get("?lead_id=1'%20or%20'1'='1&assigned_to=nope");
    expect(scopeCall!.filters).toMatchObject({ leadId: null, assignedTo: null });
  });

  it("anything but due=today means all pending", async () => {
    await get("?due=whenever");
    expect(scopeCall!.filters).toMatchObject({ due: "all" });
  });

  it("a database error is a 500, not an empty list", async () => {
    result = { data: [], error: { message: "boom" }, count: null };
    expect((await get("?page=1")).status).toBe(500);
    expect((await get()).status).toBe(500);
  });
});

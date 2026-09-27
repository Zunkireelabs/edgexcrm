import { describe, it, expect, vi, beforeEach } from "vitest";

// GET /api/v1/insights/education/relay-aggregates — owner/admin only, education_consultancy only.
// Dashboard-level granted_position_ids already hides this in the UI; this route must not rely on
// that alone (defense in depth per CLAUDE.md's checklist).

const auth = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: vi.fn(async () => auth.current),
}));

vi.mock("@/industries/_loader", () => ({
  getFeatureAccess: (industryId: string | null) => industryId === "education_consultancy",
}));

const rpcResult = vi.hoisted(() => ({ data: [{ stage_slug: "qualified", cnt: 3 }] as unknown, error: null as unknown }));

vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: vi.fn(async () => ({
    raw: () => ({
      rpc: vi.fn(async () => rpcResult),
      from: () => ({
        select: () => ({ eq: () => ({ single: async () => ({ data: { timezone: "Asia/Kathmandu" } }) }) }),
      }),
    }),
  })),
}));

import { GET } from "./route";

function req(url = "http://localhost/api/v1/insights/education/relay-aggregates?window=today") {
  return { nextUrl: new URL(url) } as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
  auth.current = {
    userId: "u-1",
    email: "owner@admizz.org",
    tenantId: "tenant-A",
    role: "owner",
    industryId: "education_consultancy",
  };
  rpcResult.data = [{ stage_slug: "qualified", cnt: 3 }];
  rpcResult.error = null;
});

describe("GET /api/v1/insights/education/relay-aggregates", () => {
  it("401s when unauthenticated", async () => {
    auth.current = null;
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("403s for a non-education-consultancy tenant", async () => {
    auth.current = { ...auth.current, industryId: "it_agency" };
    const res = await GET(req());
    expect(res.status).toBe(403);
  });

  it("403s for a non-admin role", async () => {
    auth.current = { ...auth.current, role: "counselor" };
    const res = await GET(req());
    expect(res.status).toBe(403);
  });

  it("returns 200 with rows for an owner", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([{ stage_slug: "qualified", cnt: 3 }]);
  });

  it("422s on an invalid window", async () => {
    const res = await GET(req("http://localhost/api/v1/insights/education/relay-aggregates?window=bogus"));
    expect(res.status).toBe(422);
  });
});

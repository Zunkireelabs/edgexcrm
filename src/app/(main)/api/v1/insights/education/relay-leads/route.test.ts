import { describe, it, expect, vi, beforeEach } from "vitest";

// GET /api/v1/insights/education/relay-leads — Person -> Lead drill level, owner/admin only.

const auth = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: vi.fn(async () => auth.current),
}));

vi.mock("@/industries/_loader", () => ({
  getFeatureAccess: (industryId: string | null) => industryId === "education_consultancy",
}));

const rpcResult = vi.hoisted(() => ({ data: [{ lead_id: "lead-1", display_name: "Ada" }] as unknown, error: null as unknown }));
const rpcArgs = vi.hoisted(() => ({ last: null as unknown }));
const tenantConfig = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: vi.fn(async () => ({
    raw: () => ({
      rpc: vi.fn(async (_name: string, args: unknown) => {
        rpcArgs.last = args;
        return rpcResult;
      }),
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({ data: { config: tenantConfig.current } }),
          }),
        }),
      }),
    }),
  })),
}));

import { GET } from "./route";

const VALID_USER_ID = "22222222-2222-2222-2222-222222222222";

function req(qs: string) {
  return { nextUrl: new URL(`http://localhost/api/v1/insights/education/relay-leads?${qs}`) } as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
  auth.current = {
    userId: "u-1",
    email: "owner@admizz.org",
    tenantId: "tenant-A",
    role: "owner",
    industryId: "education_consultancy",
  };
  rpcResult.data = [{ lead_id: "lead-1", display_name: "Ada" }];
  rpcResult.error = null;
  rpcArgs.last = null;
  tenantConfig.current = {};
});

describe("GET /api/v1/insights/education/relay-leads", () => {
  it("401s when unauthenticated", async () => {
    auth.current = null;
    const res = await GET(req(`stage=qualified&userId=${VALID_USER_ID}`));
    expect(res.status).toBe(401);
  });

  it("403s for a non-admin role", async () => {
    auth.current = { ...auth.current, role: "counselor" };
    const res = await GET(req(`stage=qualified&userId=${VALID_USER_ID}`));
    expect(res.status).toBe(403);
  });

  it("422s when stage is missing", async () => {
    const res = await GET(req(`userId=${VALID_USER_ID}`));
    expect(res.status).toBe(422);
  });

  it("422s when userId is present but not a valid UUID (e.g. the 'unassigned' sentinel)", async () => {
    const res = await GET(req("stage=qualified&userId=unassigned"));
    expect(res.status).toBe(422);
  });

  it("treats an absent userId as the unassigned bucket — passes p_user_id=null, 200", async () => {
    const res = await GET(req("stage=qualified"));
    expect(res.status).toBe(200);
    expect((rpcArgs.last as { p_user_id: unknown }).p_user_id).toBeNull();
  });

  it("passes p_position_slug=null when position is omitted", async () => {
    const res = await GET(req(`stage=qualified&userId=${VALID_USER_ID}`));
    expect(res.status).toBe(200);
    expect((rpcArgs.last as { p_position_slug: unknown }).p_position_slug).toBeNull();
  });

  it("passes the position through when provided", async () => {
    const res = await GET(req(`stage=qualified&position=counsellor&userId=${VALID_USER_ID}`));
    expect(res.status).toBe(200);
    expect((rpcArgs.last as { p_position_slug: unknown }).p_position_slug).toBe("counsellor");
  });

  it("wraps rows as { leads, followUpStaleDays }, defaulting the threshold when unconfigured", async () => {
    const res = await GET(req(`stage=qualified&userId=${VALID_USER_ID}`));
    const body = await res.json();
    expect(body.data.leads).toEqual([{ lead_id: "lead-1", display_name: "Ada" }]);
    expect(body.data.followUpStaleDays).toBe(3);
  });

  it("surfaces the tenant's configured follow_up_stale_days", async () => {
    tenantConfig.current = { team_performance_thresholds: { follow_up_stale_days: 5 } };
    const res = await GET(req(`stage=qualified&userId=${VALID_USER_ID}`));
    const body = await res.json();
    expect(body.data.followUpStaleDays).toBe(5);
  });
});

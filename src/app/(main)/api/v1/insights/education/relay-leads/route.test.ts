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

vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: vi.fn(async () => ({
    raw: () => ({
      rpc: vi.fn(async (_name: string, args: unknown) => {
        rpcArgs.last = args;
        return rpcResult;
      }),
    }),
  })),
}));

import { GET } from "./route";

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
});

describe("GET /api/v1/insights/education/relay-leads", () => {
  it("401s when unauthenticated", async () => {
    auth.current = null;
    const res = await GET(req("stage=qualified&userId=u-2"));
    expect(res.status).toBe(401);
  });

  it("403s for a non-admin role", async () => {
    auth.current = { ...auth.current, role: "counselor" };
    const res = await GET(req("stage=qualified&userId=u-2"));
    expect(res.status).toBe(403);
  });

  it("422s when stage is missing", async () => {
    const res = await GET(req("userId=u-2"));
    expect(res.status).toBe(422);
  });

  it("422s when userId is missing", async () => {
    const res = await GET(req("stage=qualified"));
    expect(res.status).toBe(422);
  });

  it("passes p_position_slug=null when position is omitted", async () => {
    const res = await GET(req("stage=qualified&userId=u-2"));
    expect(res.status).toBe(200);
    expect((rpcArgs.last as { p_position_slug: unknown }).p_position_slug).toBeNull();
  });

  it("passes the position through when provided", async () => {
    const res = await GET(req("stage=qualified&position=counsellor&userId=u-2"));
    expect(res.status).toBe(200);
    expect((rpcArgs.last as { p_position_slug: unknown }).p_position_slug).toBe("counsellor");
  });
});

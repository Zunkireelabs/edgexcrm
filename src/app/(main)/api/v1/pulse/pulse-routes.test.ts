import { describe, it, expect, vi, beforeEach } from "vitest";

// Pulse routes (EDGEX-82): education_consultancy only, owner/admin only, on EVERY route.
// Same mocking shape as insights/education/relay-aggregates/route.test.ts.

const auth = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("@/lib/api/auth", () => ({ authenticateRequest: vi.fn(async () => auth.current) }));

// The real loader is the production gate (getFeatureAccess reads the manifests) — use it unmocked so a manifest
// regression (Pulse dropped from the education manifest) fails here.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/scoped", () => {
  const rows: Record<string, unknown> = {
    tenants: { timezone: "America/Los_Angeles", config: null },
  };
  const chain = (table: string) => {
    const c: Record<string, unknown> = {};
    const result = () => ({ data: table === "tenants" ? rows.tenants : [], error: null });
    c.select = () => c;
    c.eq = () => c;
    c.order = () => Promise.resolve(result());
    c.single = async () => result();
    c.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
    return c;
  };
  return {
    scopedClient: vi.fn(async () => ({
      from: (t: string) => chain(t),
      raw: () => ({
        from: (t: string) => chain(t),
        rpc,
        auth: { admin: { listUsers: async () => ({ data: { users: [] } }) } },
      }),
    })),
  };
});

import { GET as getPulse } from "./route";
import { GET as getEvents } from "./events/route";
import { GET as getPerson } from "./people/[userId]/route";

const UID = "11111111-1111-4111-8111-111111111111";
const req = (path: string) => ({ nextUrl: new URL(`http://localhost${path}`) }) as unknown as Parameters<typeof getPulse>[0];

const ROUTES: Array<[string, (r: ReturnType<typeof req>) => Promise<Response>, string]> = [
  ["GET /api/v1/pulse", (r) => getPulse(r), "/api/v1/pulse?window=7d"],
  ["GET /api/v1/pulse/events", (r) => getEvents(r), "/api/v1/pulse/events?window=7d&metric=calls"],
  ["GET /api/v1/pulse/people/[userId]", (r) => getPerson(r, { params: Promise.resolve({ userId: UID }) }), `/api/v1/pulse/people/${UID}?window=7d`],
];

beforeEach(() => {
  auth.current = { userId: "u-1", email: "o@x.org", tenantId: "t-1", role: "owner", industryId: "education_consultancy" };
  rpc.mockReset();
  rpc.mockResolvedValue({ data: { people: [], funnel: { stages: [], new_leads: [0, 0, 0, 0, 0], new_leads_daily: [], imported_excluded: 0, quality: { total: 0, holder_source: {}, destination: {}, origin_slug_shaped: {}, origin_name_shaped: {} } } }, error: null });
});

describe.each(ROUTES)("%s — gates", (_name, call, path) => {
  it("401s when unauthenticated", async () => {
    auth.current = null;
    expect((await call(req(path))).status).toBe(401);
  });
  it.each(["it_agency", "travel_agency", "construction", "general"])("403s for a %s tenant", async (industryId) => {
    auth.current = { ...auth.current, industryId };
    expect((await call(req(path))).status).toBe(403);
  });
  it.each(["staff", "viewer", "counselor"])("403s for role %s", async (role) => {
    auth.current = { ...auth.current, role };
    expect((await call(req(path))).status).toBe(403);
  });
  it("never reaches the database for a rejected caller", async () => {
    auth.current = { ...auth.current, role: "staff" };
    await call(req(path));
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("owner / admin, education_consultancy", () => {
  it.each(["owner", "admin"])("GET /api/v1/pulse returns 200 for %s", async (role) => {
    auth.current = { ...auth.current, role };
    const res = await getPulse(req("/api/v1/pulse?window=7d"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.window.tz).toBe("America/Los_Angeles");
    expect(body.data.signals).toBeDefined();
  });

  it("passes the tenant id from the session, never from the query string", async () => {
    await getPulse(req("/api/v1/pulse?window=7d&p_tenant=evil&tenantId=evil"));
    expect(rpc).toHaveBeenCalled();
    for (const [, args] of rpc.mock.calls) expect(args.p_tenant).toBe("t-1");
  });

  it("422s on a bad window", async () => {
    expect((await getPulse(req("/api/v1/pulse?window=90d"))).status).toBe(422);
    expect((await getPulse(req("/api/v1/pulse?window=custom&from=2026-11-05&to=2026-11-01"))).status).toBe(422);
  });

  it("events: 422s on an unknown metric or a malformed user id", async () => {
    expect((await getEvents(req("/api/v1/pulse/events?window=7d&metric=drop_table"))).status).toBe(422);
    expect((await getEvents(req("/api/v1/pulse/events?window=7d&metric=calls&user=not-a-uuid"))).status).toBe(422);
  });

  it("events: clamps the page size", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await getEvents(req("/api/v1/pulse/events?window=7d&metric=calls&limit=100000&offset=-5"));
    const args = rpc.mock.calls.find(([name]) => name === "education_pulse_events")![1];
    expect(args.p_limit).toBe(100);
    expect(args.p_offset).toBe(0);
  });

  it("500s (not a stack trace) when the database errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await getPulse(req("/api/v1/pulse?window=7d"));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("boom");
  });
});

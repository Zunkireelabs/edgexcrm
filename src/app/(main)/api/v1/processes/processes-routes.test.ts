import { describe, it, expect, vi, beforeEach } from "vitest";

// Processes routes (EDGEX-109): education_consultancy only, owner/admin only, on EVERY route. Denials happen before any DB access.
const auth = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("@/lib/api/auth", () => ({ authenticateRequest: vi.fn(async () => auth.current) }));
const scoped = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: scoped }));

import { GET as getList } from "./route";
import { GET as getOne } from "./[key]/route";
import { POST as approve } from "./[key]/versions/[versionId]/approve/route";

const req = (path: string) => ({ nextUrl: new URL(`http://localhost${path}`) }) as unknown as Parameters<typeof getList>[0];
const ROUTES: Array<[string, () => Promise<Response>]> = [
  ["GET /api/v1/processes", () => getList(req("/api/v1/processes"))],
  ["GET /api/v1/processes/[key]", () => getOne(req("/api/v1/processes/new_lead_first_call"), { params: Promise.resolve({ key: "new_lead_first_call" }) })],
  ["POST …/versions/[versionId]/approve", () => approve(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ key: "new_lead_first_call", versionId: "v1" }) })],
];

beforeEach(() => {
  scoped.mockReset();
  auth.current = { userId: "u-1", email: "o@x.org", tenantId: "t-1", role: "owner", industryId: "education_consultancy" };
});

describe.each(ROUTES)("%s", (_name, call) => {
  it("401 when anonymous", async () => {
    auth.current = null;
    expect((await call()).status).toBe(401);
    expect(scoped).not.toHaveBeenCalled();
  });
  it.each(["it_agency", "travel_agency", "construction", "general", "real_estate"])("403 for %s", async (industryId) => {
    auth.current = { ...auth.current, industryId };
    expect((await call()).status).toBe(403);
    expect(scoped).not.toHaveBeenCalled();
  });
  it.each(["staff", "viewer", "counselor"])("403 for an education %s", async (role) => {
    auth.current = { ...auth.current, role };
    expect((await call()).status).toBe(403);
    expect(scoped).not.toHaveBeenCalled();
  });
});

describe("approve route: a store error is a 500, not a 404", () => {
  it("500 when the version read errors", async () => {
    const chain: unknown = new Proxy({}, { get: (_t, k) => (k === "then" ? (res: (v: unknown) => void) => res({ data: null, error: { message: "PGRST201" } }) : () => chain) });
    scoped.mockResolvedValue({ from: () => chain, raw: () => ({ from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { name: "A", timezone: "UTC" } }) }) }) }) }) });
    const res = await approve(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ key: "new_lead_first_call", versionId: "v1" }) });
    expect(res.status).toBe(500);
  });
});

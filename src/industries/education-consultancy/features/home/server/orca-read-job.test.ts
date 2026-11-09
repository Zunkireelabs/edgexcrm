import { describe, it, expect, vi, beforeEach } from "vitest";

const fromMock = vi.fn();
const makeReadMock = vi.fn();
const scopeMock = vi.fn();
const factsMock = vi.fn();
const authMock = vi.fn();
let flag = true;

vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => ({ from: fromMock }) }));
vi.mock("@/lib/ai/flag", () => ({ isAssistantEnabled: () => flag }));
vi.mock("@/lib/api/auth", () => ({ buildUserAuthContext: authMock }));
vi.mock("./orca-read", () => ({ makeRead: makeReadMock, resolveReadScope: scopeMock, buildReadFacts: factsMock }));

/** A tiny chainable stand-in for the service client's select builders. */
function table(rows: unknown) {
  const b: Record<string, unknown> = {};
  for (const k of ["select", "eq", "gte"]) b[k] = () => b;
  b.single = async () => ({ data: rows });
  b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows }).then(res);
  return b;
}

describe("tenantsForMorningReads", () => {
  beforeEach(() => vi.clearAllMocks());
  it("AI-off (env switch) returns no tenants and does not even query", async () => {
    flag = false;
    const { tenantsForMorningReads } = await import("./orca-read-job");
    expect(await tenantsForMorningReads()).toEqual([]);
    expect(fromMock).not.toHaveBeenCalled();
  });
  it("with the switch on it asks only for education tenants with ai_enabled", async () => {
    flag = true;
    const eqs: Array<[string, unknown]> = [];
    const b: Record<string, unknown> = { select: () => b, eq: (c: string, v: unknown) => (eqs.push([c, v]), b), then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: "t1" }] }).then(r) };
    fromMock.mockReturnValue(b);
    const { tenantsForMorningReads } = await import("./orca-read-job");
    expect(await tenantsForMorningReads()).toEqual(["t1"]);
    expect(eqs).toEqual([["industry_id", "education_consultancy"], ["ai_enabled", true]]);
  });
});

describe("runMorningReadsForTenant", () => {
  const TENANT = { name: "Admizz Education", timezone: "Asia/Kathmandu", config: null };
  const at7 = new Date("2026-11-09T01:15:00.000Z");
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "u1", tenantId: "t1" });
    scopeMock.mockResolvedValue({ scope: "me", home: { mode: "own" } });
    factsMock.mockResolvedValue([{ id: "f", text: "x", href: "/home", linkLabel: "Open →" }]);
    makeReadMock.mockResolvedValue({ kind: "made", read: {} });
  });
  const wire = (homeReads: unknown[]) =>
    fromMock.mockImplementation((t: string) => (t === "tenants" ? table(TENANT) : table(homeReads)));

  it("outside the tenant's 7 o'clock hour it does nothing", async () => {
    wire([{ user_id: "u1", scope: "me", for_date: "2026-11-08", opened_at: "2026-11-08T05:00:00.000Z" }]);
    const { runMorningReadsForTenant } = await import("./orca-read-job");
    const r = await runMorningReadsForTenant("t1", new Date("2026-11-09T07:15:00.000Z"));
    expect(r.skipped).toBe("not the morning hour");
    expect(makeReadMock).not.toHaveBeenCalled();
  });
  it("makes a read for an active person, as NOT-opened (so the job can't keep itself alive)", async () => {
    wire([{ user_id: "u1", scope: "me", for_date: "2026-11-08", opened_at: "2026-11-08T05:00:00.000Z" }]);
    const { runMorningReadsForTenant } = await import("./orca-read-job");
    const r = await runMorningReadsForTenant("t1", at7);
    expect(r.made).toBe(1);
    expect(makeReadMock).toHaveBeenCalledWith(expect.objectContaining({ opened: false, refreshes: 0, scope: "me" }));
  });
  it("skips an inactive person", async () => {
    wire([{ user_id: "u1", scope: "me", for_date: "2026-10-30", opened_at: "2026-10-30T05:00:00.000Z" }]);
    const { runMorningReadsForTenant } = await import("./orca-read-job");
    const r = await runMorningReadsForTenant("t1", at7);
    expect(r.made).toBe(0);
    expect(makeReadMock).not.toHaveBeenCalled();
  });
  it("a branch manager pinned to a branch is left for their first open", async () => {
    wire([{ user_id: "u1", scope: "business", for_date: "2026-11-08", opened_at: "2026-11-08T05:00:00.000Z" }]);
    scopeMock.mockResolvedValue({ scope: "business", home: { mode: "manager", pinned: true } });
    const { runMorningReadsForTenant } = await import("./orca-read-job");
    const r = await runMorningReadsForTenant("t1", at7);
    expect(r).toMatchObject({ made: 0, needsSession: 1 });
  });
  it("stops at the daily budget", async () => {
    wire([
      { user_id: "u1", scope: "me", for_date: "2026-11-08", opened_at: "2026-11-08T05:00:00.000Z" },
      { user_id: "u2", scope: "me", for_date: "2026-11-08", opened_at: "2026-11-08T05:00:00.000Z" },
    ]);
    makeReadMock.mockResolvedValue({ kind: "paused" });
    const { runMorningReadsForTenant } = await import("./orca-read-job");
    const r = await runMorningReadsForTenant("t1", at7);
    expect(r.paused).toBe(true);
    expect(makeReadMock).toHaveBeenCalledTimes(1);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

// Click-through round 5, N: on the path that stores a decision, a failed read must not look like an empty result.
type Res = { data?: unknown; count?: number; error?: { message: string } | null };
const state = vi.hoisted(() => ({ results: {} as Record<string, unknown> }));
const namesMock = vi.hoisted(() => vi.fn());
const workableMock = vi.hoisted(() => vi.fn());
const policyMock = vi.hoisted(() => vi.fn());
const serviceMock = vi.hoisted(() => vi.fn());

function chainFor(table: string) {
  const res = (): Res => ({ data: [], count: 0, error: null, ...((state.results[table] as Res | undefined) ?? {}) });
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "not", "in", "gte", "lte", "or", "limit", "order"]) chain[m] = () => chain;
  chain.maybeSingle = async () => res();
  chain.then = (ok: (v: unknown) => unknown) => ok(res());
  return chain;
}

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClientForTenant: async () => ({ from: chainFor, fromGlobal: chainFor }) }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: serviceMock, createClient: vi.fn() }));
vi.mock("@/lib/supabase/queries", () => ({ resolveUserNames: namesMock }));
vi.mock("../workable", () => ({ loadWorkablePlan: workableMock }));
vi.mock("../lead-notes", () => ({ leadNotes: () => chainFor("lead_notes"), noteReadFailed: vi.fn() }));
vi.mock("../../../processes/server/policy", () => ({ loadProcessPolicy: policyMock }));
vi.mock("@/lib/api/auth", () => ({ buildUserAuthContext: vi.fn() }));
vi.mock("@/lib/leads/apply-lead-patch", () => ({ applyLeadPatch: vi.fn() }));

import { buildPool, decideForLead } from "./engine";
import { findSystemOwner } from "./assign";
import { loadLearnedPositions, type TenantDb } from "./settings";

const NOW = new Date("2026-11-09T06:00:00Z");
const LEAD = { id: "l1", assigned_to: null, branch_id: null, destinations: null, first_name: "A", last_name: "B" };
const member = (id: string) => ({ user_id: id, branch_id: null, suspended_at: null, positions: { slug: "counselor", name: "Counselor" } });
const db = { from: chainFor, fromGlobal: chainFor } as unknown as TenantDb;

beforeEach(() => {
  state.results = {
    lead_assignment_settings: { data: { mode: "auto", first_touch_positions: ["counselor"] } },
    tenants: { data: { timezone: "UTC" } },
    tenant_users: { data: [member("a"), member("b")] },
    leads: { data: LEAD, count: 0 },
    lead_activities: { data: [], count: 1 },
  };
  namesMock.mockReset().mockResolvedValue(new Map([["a", "Asha"], ["b", "Bina"]]));
  workableMock.mockReset().mockResolvedValue({ activeListIds: [] });
  policyMock.mockReset().mockResolvedValue({ firstTouchPositions: ["counselor"] });
});

describe("decideForLead asks for strict reads", () => {
  it("policy, workable plan and names", async () => {
    await decideForLead("t", "l1", "auto", NOW);
    expect(policyMock).toHaveBeenCalledWith(expect.anything(), "t", { strict: true });
    expect(workableMock).toHaveBeenCalledWith(expect.anything(), { strict: true });
    expect(namesMock).toHaveBeenCalledWith(["a", "b"], { strict: true });
  });
  it.each([
    ["policy", policyMock],
    ["workable plan", workableMock],
    ["names", namesMock],
  ])("a failed %s read propagates instead of storing a decision", async (_name, mock) => {
    mock.mockRejectedValue(new Error("read failed"));
    await expect(decideForLead("t", "l1", "auto", NOW)).rejects.toThrow("read failed");
  });
  it("Home's suggestion path (buildPool without strict) keeps its tolerant reads", async () => {
    await buildPool(db, "t", NOW);
    expect(policyMock).toHaveBeenCalledWith(expect.anything(), "t", {});
    expect(workableMock).toHaveBeenCalledWith(expect.anything(), {});
    expect(namesMock).toHaveBeenCalledWith(["a", "b"], {});
  });
});

describe("loadLearnedPositions", () => {
  it("throws when the team read fails", async () => {
    state.results.tenant_users = { data: null, error: { message: "gateway" } };
    await expect(loadLearnedPositions(db, NOW)).rejects.toThrow(/team read failed: gateway/);
  });
  it("throws when a lead count fails", async () => {
    state.results.leads = { count: undefined, error: { message: "gateway" } };
    await expect(loadLearnedPositions(db, NOW)).rejects.toThrow(/lead count failed: gateway/);
  });
  it("a team of nobody is still an answer", async () => {
    state.results.tenant_users = { data: [] };
    await expect(loadLearnedPositions(db, NOW)).resolves.toBeDefined();
  });
});

describe("findSystemOwner", () => {
  it("strict: a failed read throws instead of reading as no owner", async () => {
    state.results.tenant_users = { data: null, error: { message: "gateway" } };
    await expect(findSystemOwner("t", { strict: true })).rejects.toThrow(/owner read failed: gateway/);
  });
  it("default: stays tolerant for its other callers", async () => {
    state.results.tenant_users = { data: null, error: { message: "gateway" } };
    await expect(findSystemOwner("t")).resolves.toBeNull();
  });
});

describe("loadWorkablePlan (the real one)", () => {
  const load = async () => (await vi.importActual<typeof import("../workable")>("../workable")).loadWorkablePlan;
  const workDb = { from: chainFor } as never;
  it.each(["lead_lists", "pipeline_stages"])("strict: a failed %s read throws", async (table) => {
    state.results[table] = { data: null, error: { message: "gateway" } };
    await expect((await load())(workDb, { strict: true })).rejects.toThrow(/workable plan: read failed: gateway/);
  });
  it("default: a failed read still reads as an empty plan", async () => {
    state.results.lead_lists = { data: null, error: { message: "gateway" } };
    expect((await (await load())(workDb)).activeListIds).toEqual([]);
  });
});

describe("loadProcessPolicy (the real one)", () => {
  const load = async () => (await vi.importActual<typeof import("../../../processes/server/policy")>("../../../processes/server/policy")).loadProcessPolicy;
  const policyDb = (processes: Res) =>
    ({
      from: (t: string) => { state.results[t] = processes; return chainFor(t); },
      raw: () => ({ rpc: async () => ({ data: null, error: null }) }),
    }) as never;
  it("strict: a failed read throws", async () => {
    await expect((await load())(policyDb({ data: null, error: { message: "gateway" } }), "t-strict-1", { strict: true })).rejects.toThrow(/process policy: read failed: gateway/);
  });
  it("strict: no live process is an answer, not a failure", async () => {
    const p = await (await load())(policyDb({ data: { owner_user_id: null, live_version_id: null }, error: null }), "t-strict-2", { strict: true });
    expect(p.firstTouchPositions).toBeNull();
  });
  it("default: a failed read still falls back", async () => {
    const p = await (await load())(policyDb({ data: null, error: { message: "gateway" } }), "t-strict-3");
    expect(p.source).toBeNull();
  });
});

describe("resolveUserNames (the real one)", () => {
  const load = async () => (await vi.importActual<typeof import("@/lib/supabase/queries")>("@/lib/supabase/queries")).resolveUserNames;
  const client = (listUsers: () => Promise<unknown>) => serviceMock.mockResolvedValue({ auth: { admin: { listUsers } } });
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

  it("strict: an error response throws", async () => {
    client(async () => ({ data: { users: [] }, error: { message: "auth down" } }));
    await expect((await load())(["a"], { strict: true })).rejects.toThrow(/resolveUserNames/);
  });
  it("strict: a thrown client error throws", async () => {
    client(async () => { throw new Error("network"); });
    await expect((await load())(["a"], { strict: true })).rejects.toThrow(/resolveUserNames: network/);
  });
  it("default: a failure still returns no names", async () => {
    client(async () => { throw new Error("network"); });
    expect((await (await load())(["a"])).size).toBe(0);
  });
  it("strict: a good read returns the names", async () => {
    client(async () => ({ data: { users: [{ id: "a", email: "asha@x.test", user_metadata: { name: "Asha" } }] }, error: null }));
    expect((await (await load())(["a"], { strict: true })).get("a")).toBe("Asha");
  });
});

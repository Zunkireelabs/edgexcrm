import { beforeEach, describe, expect, it, vi } from "vitest";

type Res = { data?: unknown; count?: number; error?: { message: string } | null };
const state = vi.hoisted(() => ({ results: {} as Record<string, unknown>, tables: [] as string[] }));

function chainFor(table: string) {
  state.tables.push(table);
  const res = (): Res => ({ data: [], count: 0, error: null, ...((state.results[table] as Res | undefined) ?? {}) });
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "not", "in", "gte", "lte", "or", "limit", "order"]) chain[m] = () => chain;
  chain.maybeSingle = async () => res();
  chain.then = (ok: (v: unknown) => unknown) => ok(res());
  return chain;
}

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClientForTenant: async () => ({ from: chainFor, fromGlobal: chainFor }) }));
vi.mock("@/lib/supabase/queries", () => ({ resolveUserNames: async () => new Map([["a", "Asha"], ["b", "Bina"]]) }));
vi.mock("../workable", () => ({ loadWorkablePlan: async () => ({ activeListIds: [] }) }));
vi.mock("../lead-notes", () => ({ leadNotes: () => chainFor("lead_notes"), noteReadFailed: vi.fn() }));
vi.mock("../../../processes/server/policy", () => ({ loadProcessPolicy: async () => ({ firstTouchPositions: ["counselor"] }) }));

import { decideForLead, loadLeadForAssignment } from "./engine";
import type { TenantDb } from "./settings";

const NOW = new Date("2026-11-09T06:00:00Z");
const LEAD = { id: "l1", assigned_to: null, branch_id: null, destinations: null, first_name: "A", last_name: "B" };
const member = (id: string) => ({ user_id: id, branch_id: null, suspended_at: null, positions: { slug: "counselor", name: "Counselor" } });

beforeEach(() => {
  state.tables.length = 0;
  state.results = {
    lead_assignment_settings: { data: { mode: "shadow", first_touch_positions: ["counselor"] } },
    tenants: { data: { timezone: "UTC" } },
    tenant_users: { data: [member("a"), member("b")] },
    leads: { data: LEAD, count: 0 },
    lead_activities: { data: [], count: 1 },
    lead_assignment_decisions: { data: [{ picked_user_id: "a" }, { picked_user_id: "a" }, { picked_user_id: "a" }] },
  };
});

const today = async (mode: "shadow" | "auto") => {
  const r = await decideForLead("t", "l1", mode, NOW);
  return Object.fromEntries((r?.decision.candidates ?? []).map((c) => [c.userId, c.receivedToday]));
};

describe("decideForLead: a burst under shadow (click-through round 4, I part 2)", () => {
  it("shadow: today's open picks count as received today, so a burst spreads the way auto would", async () => {
    expect(await today("shadow")).toEqual({ a: 3, b: 0 });
  });
  it("auto: unchanged, and the picks are not even read", async () => {
    expect(await today("auto")).toEqual({ a: 0, b: 0 });
    expect(state.tables).not.toContain("lead_assignment_decisions");
  });
});

describe("decideForLead: a failed query is not a missing lead (click-through round 4, J)", () => {
  it("a lead that truly is not there is null", async () => {
    state.results.leads = { data: null, count: 0 };
    expect(await decideForLead("t", "l1", "shadow", NOW)).toBeNull();
  });
  it("a failed lead read throws", async () => {
    state.results.leads = { data: null, error: { message: "gateway" } };
    await expect(decideForLead("t", "l1", "shadow", NOW)).rejects.toThrow(/lead read failed: gateway/);
  });
  it("a failed member read throws: it must not be stored as 'nobody could take it'", async () => {
    state.results.tenant_users = { data: null, error: { message: "gateway" } };
    await expect(decideForLead("t", "l1", "shadow", NOW)).rejects.toThrow(/team members read failed/);
  });
  it("a failed settings read throws: it must not read as 'off'", async () => {
    state.results.lead_assignment_settings = { data: null, error: { message: "gateway" } };
    await expect(decideForLead("t", "l1", "shadow", NOW)).rejects.toThrow(/settings read failed/);
  });
  it("a failed read of today's picks throws", async () => {
    state.results.lead_assignment_decisions = { data: null, error: { message: "gateway" } };
    await expect(decideForLead("t", "l1", "shadow", NOW)).rejects.toThrow(/shadow picks read failed/);
  });
  it("loadLeadForAssignment says the same", async () => {
    const db = { from: chainFor } as unknown as TenantDb;
    state.results.leads = { data: null, error: { message: "gateway" } };
    await expect(loadLeadForAssignment(db, "l1")).rejects.toThrow(/lead read failed/);
    state.results.leads = { data: null };
    expect(await loadLeadForAssignment(db, "l1")).toBeNull();
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/queries", () => ({
  getLeaveForHome: vi.fn(),
  resolveUserNames: vi.fn(async (ids: string[]) => new Map(ids.filter((i) => i === "gone1").map((i) => [i, "Ravi Sah"]))),
}));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: vi.fn() }));

import { loadFormerHolders, loadUnassigned } from "./load-manager";
import { buildWorkablePlan } from "../lib/workable";
import type { HomeDb } from "./load-home";

type Call = [string, ...unknown[]];

/** A chainable, awaitable fake that records every filter call per table. */
function fakeDb(tables: Record<string, unknown[]>, count?: number) {
  const calls: Record<string, Call[]> = {};
  const db = {
    from(table: string) {
      const log: Call[] = (calls[table] = calls[table] ?? []);
      const q: Record<string, unknown> = {};
      for (const m of ["select", "not", "is", "in", "eq", "or", "order", "limit"]) q[m] = (...a: unknown[]) => (log.push([m, ...a]), q);
      q.then = (res: (v: unknown) => unknown) =>
        res({ data: tables[table] ?? [], count: table === "leads" ? count ?? (tables[table] ?? []).length : tables[table]?.length ?? 0 });
      return q;
    },
  };
  return { db: db as unknown as HomeDb, calls };
}

const lists = [
  { id: "L-app", name: "Applications" },
  { id: "L-arch", name: "Archived" },
  { id: "L-stg", name: "Staging" },
];
// Only L-app is active; "dropped" is terminal everywhere.
const plan = buildWorkablePlan(["L-app"], [{ pipeline_id: "P1", slug: "dropped", is_terminal: true }]);
const noPlan = buildWorkablePlan([], []);

describe("loadFormerHolders", () => {
  it("scopes to active lists, live leads, and holders outside tenant_users (suspended stay members)", async () => {
    const { db, calls } = fakeDb({ lead_lists: lists, tenant_users: [{ user_id: "m1" }, { user_id: "m2-suspended" }], leads: [] });
    await loadFormerHolders(db, null, plan);
    const l = calls.leads;
    // the shared definition (lib/workable.ts): active list, live, not terminal / walk-in / on hold
    expect(l).toContainEqual(["in", "list_id", ["L-app"]]);
    expect(l).toContainEqual(["is", "deleted_at", null]);
    expect(l).toContainEqual(["is", "archived_at", null]);
    expect(l).toContainEqual(["or", "on_hold.is.null,on_hold.eq.false"]);
    expect(l).toContainEqual(["or", "tags.is.null,tags.not.ov.{other,parent}"]);
    expect(l).toContainEqual(["or", 'status.is.null,status.not.in.("dropped")']);
    expect(l).toContainEqual(["not", "assigned_to", "is", null]);
    expect(l).toContainEqual(["not", "assigned_to", "in", "(m1,m2-suspended)"]);
    expect(l.some((c) => c[0] === "eq" && c[1] === "branch_id")).toBe(false);
  });

  it("a branch manager only sees their branch", async () => {
    const { db, calls } = fakeDb({ lead_lists: lists, tenant_users: [{ user_id: "m1" }], leads: [] });
    await loadFormerHolders(db, "B1", plan);
    expect(calls.leads).toContainEqual(["eq", "branch_id", "B1"]);
  });

  it("returns nothing when there is no active list", async () => {
    const { db, calls } = fakeDb({ lead_lists: lists, tenant_users: [], leads: [] });
    const r = await loadFormerHolders(db, null, noPlan);
    expect(r.total).toBe(0);
    expect(calls.leads).toBeUndefined();
  });

  it("sums stage spread, holders (named or null) and applications", async () => {
    const { db } = fakeDb(
      {
        lead_lists: lists,
        tenant_users: [{ user_id: "m1" }],
        leads: [
          { id: "a", list_id: "L-app", assigned_to: "gone1" },
          { id: "b", list_id: "L-app", assigned_to: "gone1" },
          { id: "c", list_id: "L-app", assigned_to: "gone2" },
        ],
        applications: [{}, {}],
      },
      3,
    );
    const r = await loadFormerHolders(db, null, plan);
    expect(r.total).toBe(3);
    expect(r.byStage).toEqual([{ name: "Applications", count: 3 }]);
    expect(r.byHolder).toEqual([{ name: "Ravi Sah", count: 2 }, { name: null, count: 1 }]);
    expect(r.holderIds).toEqual(["gone1", "gone2"]);
    expect(r.activeListIds).toEqual(["L-app"]);
  });
});

describe("loadUnassigned", () => {
  it("applies the shared workable definition to the unassigned count", async () => {
    const { db, calls } = fakeDb({ leads: [{ id: "a", created_at: "2026-11-01" }] });
    const r = await loadUnassigned(db, "B1", plan);
    expect(r.count).toBe(1);
    expect(calls.leads).toContainEqual(["is", "assigned_to", null]);
    expect(calls.leads).toContainEqual(["in", "list_id", ["L-app"]]);
    expect(calls.leads).toContainEqual(["or", 'status.is.null,status.not.in.("dropped")']);
    expect(calls.leads).toContainEqual(["or", "tags.is.null,tags.not.ov.{other,parent}"]);
    expect(calls.leads).toContainEqual(["eq", "branch_id", "B1"]);
  });
  it("no active list: no query at all", async () => {
    const { db, calls } = fakeDb({});
    expect((await loadUnassigned(db, null, noPlan)).count).toBe(0);
    expect(calls.leads).toBeUndefined();
  });
});

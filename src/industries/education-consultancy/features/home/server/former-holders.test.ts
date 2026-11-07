import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/queries", () => ({
  getLeaveForHome: vi.fn(),
  resolveUserNames: vi.fn(async (ids: string[]) => new Map(ids.filter((i) => i === "gone1").map((i) => [i, "Ravi Sah"]))),
}));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: vi.fn() }));

import { loadFormerHolders } from "./load-manager";
import type { HomeDb } from "./load-home";

type Call = [string, ...unknown[]];

/** A chainable, awaitable fake that records every filter call per table. */
function fakeDb(tables: Record<string, unknown[]>, count?: number) {
  const calls: Record<string, Call[]> = {};
  const db = {
    from(table: string) {
      const log: Call[] = (calls[table] = calls[table] ?? []);
      const q: Record<string, unknown> = {};
      for (const m of ["select", "not", "is", "in", "eq", "limit"]) q[m] = (...a: unknown[]) => (log.push([m, ...a]), q);
      q.then = (res: (v: unknown) => unknown) =>
        res({ data: tables[table] ?? [], count: table === "leads" ? count ?? (tables[table] ?? []).length : tables[table]?.length ?? 0 });
      return q;
    },
  };
  return { db: db as unknown as HomeDb, calls };
}

const lists = [
  { id: "L-app", name: "Applications", is_archive: false, is_staging: false },
  { id: "L-arch", name: "Archived", is_archive: true, is_staging: false },
  { id: "L-stg", name: "Staging", is_archive: false, is_staging: true },
];

describe("loadFormerHolders", () => {
  it("scopes to active lists, live leads, and holders outside tenant_users (suspended stay members)", async () => {
    const { db, calls } = fakeDb({ lead_lists: lists, tenant_users: [{ user_id: "m1" }, { user_id: "m2-suspended" }], leads: [] });
    await loadFormerHolders(db, null);
    const l = calls.leads;
    expect(l).toContainEqual(["in", "list_id", ["L-app"]]);
    expect(l).toContainEqual(["is", "deleted_at", null]);
    expect(l).toContainEqual(["is", "archived_at", null]);
    expect(l).toContainEqual(["not", "assigned_to", "is", null]);
    expect(l).toContainEqual(["not", "assigned_to", "in", "(m1,m2-suspended)"]);
    expect(l.some((c) => c[0] === "eq" && c[1] === "branch_id")).toBe(false);
  });

  it("a branch manager only sees their branch", async () => {
    const { db, calls } = fakeDb({ lead_lists: lists, tenant_users: [{ user_id: "m1" }], leads: [] });
    await loadFormerHolders(db, "B1");
    expect(calls.leads).toContainEqual(["eq", "branch_id", "B1"]);
  });

  it("returns nothing when there is no active list", async () => {
    const { db, calls } = fakeDb({ lead_lists: [lists[1]], tenant_users: [], leads: [] });
    const r = await loadFormerHolders(db, null);
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
    const r = await loadFormerHolders(db, null);
    expect(r.total).toBe(3);
    expect(r.byStage).toEqual([{ name: "Applications", count: 3 }]);
    expect(r.byHolder).toEqual([{ name: "Ravi Sah", count: 2 }, { name: null, count: 1 }]);
    expect(r.holderIds).toEqual(["gone1", "gone2"]);
    expect(r.activeListIds).toEqual(["L-app"]);
  });
});

import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/api/auth";
import type { ApplyLeadPatchOutcome } from "@/lib/leads/apply-lead-patch";
import { clearStaleCallbacks, countStaleCallbacks } from "./stale-callbacks";

const now = new Date("2026-11-09T04:15:00.000Z");
const TZ = "Asia/Kathmandu";

/** A chain recorder: every builder call is recorded, awaiting resolves to the scripted result. */
function fakeDb(ids: string[], count: number) {
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const chain: Record<string, unknown> = {};
  for (const fn of ["select", "is", "not", "lt", "eq", "order", "limit"]) {
    chain[fn] = (...args: unknown[]) => {
      calls.push({ fn, args });
      return chain;
    };
  }
  chain.then = (resolve: (v: unknown) => void) => {
    const head = calls.find((c) => c.fn === "select" && (c.args[1] as { head?: boolean } | undefined)?.head);
    resolve(head ? { count, error: null } : { data: ids.map((id) => ({ id })), error: null });
  };
  return { db: { from: (t: string) => (calls.push({ fn: "from", args: [t] }), chain) } as never, calls };
}

const auth = { userId: "m", tenantId: "t" } as AuthContext;
const ok = { kind: "ok" } as unknown as ApplyLeadPatchOutcome;

describe("clearStaleCallbacks", () => {
  it("clears each lead with callback_due_at: null through the patch path, and reports cleared / failed / remaining", async () => {
    const { db } = fakeDb(["a", "b", "c"], 0);
    const patch = vi.fn(async (...args: [AuthContext, string, Record<string, unknown>]) => (args[1] === "b" ? ({ kind: "forbidden" } as ApplyLeadPatchOutcome) : ok));
    const r = await clearStaleCallbacks(db, auth, { mode: "manager", branchId: null, pinned: false }, now, TZ, patch);
    expect(patch.mock.calls.map((c) => [c[1], c[2]])).toEqual([["a", { callback_due_at: null }], ["b", { callback_due_at: null }], ["c", { callback_due_at: null }]]);
    expect(r).toEqual({ cleared: 2, failed: 1, remaining: 0 });
  });

  it("scope: a branch-pinned manager only touches their branch; an owner on 'all' adds no branch filter", async () => {
    const pinned = fakeDb(["a"], 0);
    await clearStaleCallbacks(pinned.db, auth, { mode: "manager", branchId: "b1", pinned: true }, now, TZ, async () => ok);
    expect(pinned.calls.some((c) => c.fn === "eq" && c.args[0] === "branch_id" && c.args[1] === "b1")).toBe(true);
    const all = fakeDb(["a"], 0);
    await clearStaleCallbacks(all.db, auth, { mode: "manager", branchId: null, pinned: false }, now, TZ, async () => ok);
    expect(all.calls.some((c) => c.fn === "eq" && c.args[0] === "branch_id")).toBe(false);
  });

  it("the set is 'older than 14 tenant-local days', never client ids, never deleted leads, capped at 1,000", async () => {
    const f = fakeDb([], 0);
    await clearStaleCallbacks(f.db, auth, { mode: "manager", branchId: null, pinned: false }, now, TZ, async () => ok);
    expect(f.calls.find((c) => c.fn === "lt")!.args).toEqual(["callback_due_at", "2026-10-25T18:15:00.000Z"]);
    expect(f.calls.some((c) => c.fn === "is" && c.args[0] === "deleted_at")).toBe(true);
    expect(f.calls.find((c) => c.fn === "limit")!.args[0]).toBe(1000);
  });

  it("a patch that throws counts as failed, not a crash", async () => {
    const { db } = fakeDb(["a"], 1);
    const r = await clearStaleCallbacks(db, auth, { mode: "manager", branchId: null, pinned: false }, now, TZ, async () => { throw new Error("boom"); });
    expect(r).toEqual({ cleared: 0, failed: 1, remaining: 1 });
  });

  it("idempotent: nothing matching → nothing patched", async () => {
    const { db } = fakeDb([], 0);
    const patch = vi.fn(async () => ok);
    expect(await clearStaleCallbacks(db, auth, { mode: "manager", branchId: null, pinned: false }, now, TZ, patch)).toEqual({ cleared: 0, failed: 0, remaining: 0 });
    expect(patch).not.toHaveBeenCalled();
  });
});

describe("countStaleCallbacks", () => {
  it("reads an exact head count", async () => {
    expect(await countStaleCallbacks(fakeDb([], 572).db, { mode: "manager", branchId: null, pinned: false }, now, TZ)).toBe(572);
  });
});

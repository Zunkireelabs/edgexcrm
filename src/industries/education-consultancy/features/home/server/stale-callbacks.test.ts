import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/api/auth";
import type { ApplyLeadPatchOutcome } from "@/lib/leads/apply-lead-patch";
import type { ScopedLeads } from "./lead-scope";
import { clearStaleCallbacks, countStaleCallbacks } from "./stale-callbacks";

const now = new Date("2026-11-09T04:15:00.000Z");
const TZ = "Asia/Kathmandu";

/** A ScopedLeads whose chain records every builder call; awaiting resolves to the scripted result. */
function fakeLeads(ids: string[], count: number): { leads: ScopedLeads; calls: Array<{ fn: string; args: unknown[] }> } {
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const chain: Record<string, unknown> = {};
  for (const fn of ["is", "not", "lt", "eq", "in", "or", "order", "limit"]) {
    chain[fn] = (...args: unknown[]) => (calls.push({ fn, args }), chain);
  }
  let head = false;
  chain.then = (resolve: (v: unknown) => void) => resolve(head ? { count, error: null } : { data: ids.map((id) => ({ id })), error: null });
  return {
    calls,
    leads: { definition: "tenant", select: (columns, opts) => (calls.push({ fn: "select", args: [columns, opts] }), (head = !!opts?.head), chain) },
  };
}

const auth = { userId: "m", tenantId: "t" } as AuthContext;
const ok = { kind: "ok" } as unknown as ApplyLeadPatchOutcome;

describe("clearStaleCallbacks", () => {
  it("clears each lead with callback_due_at: null through the patch path, and reports cleared / failed / remaining", async () => {
    const { leads } = fakeLeads(["a", "b", "c"], 0);
    const patch = vi.fn(async (...args: [AuthContext, string, Record<string, unknown>]) => (args[1] === "b" ? ({ kind: "forbidden" } as ApplyLeadPatchOutcome) : ok));
    const r = await clearStaleCallbacks(leads, auth, now, TZ, patch);
    expect(patch.mock.calls.map((c) => [c[1], c[2]])).toEqual([["a", { callback_due_at: null }], ["b", { callback_due_at: null }], ["c", { callback_due_at: null }]]);
    expect(r).toEqual({ cleared: 2, failed: 1, remaining: 0 });
  });

  it("the exact predicate: not deleted, has a call-back, older than local midnight of today-14, oldest first, capped at 1,000", async () => {
    const f = fakeLeads([], 0);
    await clearStaleCallbacks(f.leads, auth, now, TZ, async () => ok);
    expect(f.calls.find((c) => c.fn === "is")!.args).toEqual(["deleted_at", null]);
    expect(f.calls.find((c) => c.fn === "not")!.args).toEqual(["callback_due_at", "is", null]);
    expect(f.calls.find((c) => c.fn === "lt")!.args).toEqual(["callback_due_at", "2026-10-25T18:15:00.000Z"]);
    expect(f.calls.find((c) => c.fn === "order")!.args).toEqual(["callback_due_at", { ascending: true }]);
    expect(f.calls.find((c) => c.fn === "limit")!.args[0]).toBe(1000);
  });

  it("a patch that throws counts as failed, not a crash", async () => {
    const { leads } = fakeLeads(["a"], 1);
    expect(await clearStaleCallbacks(leads, auth, now, TZ, async () => { throw new Error("boom"); })).toEqual({ cleared: 0, failed: 1, remaining: 1 });
  });

  it("idempotent: nothing matching → nothing patched", async () => {
    const { leads } = fakeLeads([], 0);
    const patch = vi.fn(async () => ok);
    expect(await clearStaleCallbacks(leads, auth, now, TZ, patch)).toEqual({ cleared: 0, failed: 0, remaining: 0 });
    expect(patch).not.toHaveBeenCalled();
  });
});

describe("countStaleCallbacks", () => {
  it("reads an exact head count over the same predicate", async () => {
    const f = fakeLeads([], 558);
    expect(await countStaleCallbacks(f.leads, now, TZ)).toBe(558);
    expect(f.calls.find((c) => c.fn === "select")!.args[1]).toEqual({ count: "exact", head: true });
    expect(f.calls.find((c) => c.fn === "lt")!.args).toEqual(["callback_due_at", "2026-10-25T18:15:00.000Z"]);
  });
});

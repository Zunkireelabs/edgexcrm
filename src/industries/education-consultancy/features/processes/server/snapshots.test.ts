import { describe, it, expect, vi, beforeEach } from "vitest";

const upserts = vi.hoisted(() => [] as Array<{ row: Record<string, unknown>; opts: Record<string, unknown> }>);
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn() }));
vi.mock("@/lib/supabase/scoped", () => ({
  scopedClientForTenant: vi.fn(async () => ({
    from: () => ({ select: async () => ({ data: [{ id: "p1", key: "new_lead_first_call", live_version_id: "v1" }, { id: "p2", key: "leaver_handover", live_version_id: null }] }) }),
    raw: () => ({
      rpc,
      from: (t: string) =>
        t === "tenants"
          ? { select: () => ({ eq: () => ({ single: async () => ({ data: { timezone: "Asia/Kathmandu" } }) }) }) }
          : { upsert: async (row: Record<string, unknown>, opts: Record<string, unknown>) => { upserts.push({ row, opts }); return { error: null }; } },
    }),
  })),
}));

import { localDay, snapshotTenant } from "./snapshots";

beforeEach(() => { upserts.length = 0; rpc.mockReset(); rpc.mockResolvedValue({ data: { arrived: 5 }, error: null }); });

describe("snapshotTenant", () => {
  it("writes one row per process keyed (process_id, day), with the live version id", async () => {
    const out = await snapshotTenant("t1", new Date("2026-11-07T20:50:00Z"));
    expect(out).toEqual({ written: 2, skipped: 0 });
    expect(upserts.map((u) => [u.row.process_id, u.row.version_id, u.row.day])).toEqual([["p1", "v1", "2026-11-08"], ["p2", null, "2026-11-08"]]);
    expect(upserts.every((u) => u.opts.onConflict === "process_id,day" && u.row.tenant_id === "t1")).toBe(true);
  });
  it("is idempotent per day: a rerun targets the same (process, day) keys", async () => {
    const now = new Date("2026-11-07T20:50:00Z");
    await snapshotTenant("t1", now);
    await snapshotTenant("t1", new Date(now.getTime() + 3600_000));
    const keys = upserts.map((u) => `${u.row.process_id}|${u.row.day}`);
    expect(new Set(keys).size).toBe(2);
  });
  it("skips a process whose metrics errored instead of writing nulls", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect(await snapshotTenant("t1")).toEqual({ written: 1, skipped: 1 });
  });
  it("localDay uses the tenant timezone", () => {
    expect(localDay(new Date("2026-11-07T20:50:00Z"), "Asia/Kathmandu")).toBe("2026-11-08");
    expect(localDay(new Date("2026-11-07T20:50:00Z"), "UTC")).toBe("2026-11-07");
  });
});

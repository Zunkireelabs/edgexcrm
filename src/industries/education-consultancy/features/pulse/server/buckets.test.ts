import { describe, it, expect, vi } from "vitest";
import { loadBuckets, mergeFunnels, type OverviewJson } from "./buckets";
import { resolvePulseWindow } from "../lib/window";
import type { PulseContext } from "./context";

const TZ = "Asia/Kathmandu";
const ctxFor = (key: string, now: string) => ({ window: resolvePulseWindow(key, new Date(now), TZ)!, tz: TZ }) as unknown as PulseContext;
const row = (user_id: string, bucket: number, calls: number) => ({ user_id, bucket, counts: { calls }, notes_new: 0, notes_edited: 0, moves_by_stage: {}, back_by_stage: {}, bulk_moves: 0 });

describe("loadBuckets", () => {
  it("rolling windows: ONE call, buckets untouched, usual = 1..4", async () => {
    const call = vi.fn().mockResolvedValue({ data: { people: [row("a", 0, 5), row("a", 1, 7)] }, error: null });
    const { buckets } = await loadBuckets<OverviewJson>(ctxFor("7d", "2026-11-05T06:00:00Z"), call, (d) => d.people);
    expect(call).toHaveBeenCalledTimes(1);
    expect(buckets.usualBuckets).toEqual([1, 2, 3, 4]);
    expect(buckets.rows.map((r) => r.bucket)).toEqual([0, 1]);
  });
  it("Today: six aligned calls (today, yesterday, same weekday ×4), bucket 0 of each renumbered 0..5", async () => {
    const spans: Array<[string, string]> = [];
    const call = vi.fn().mockImplementation(async (s: { from: Date; to: Date }) => {
      spans.push([s.from.toISOString(), s.to.toISOString()]);
      const n = spans.length; // 1..6, in call order
      return { data: { people: [row("a", 0, n * 10), row("a", 1, 999)] }, error: null }; // bucket 1+ of each call must be ignored
    });
    const { buckets } = await loadBuckets<OverviewJson>(ctxFor("today", "2026-11-05T06:00:00Z"), call, (d) => d.people);
    expect(call).toHaveBeenCalledTimes(6);
    expect(spans[0][0]).toBe("2026-11-04T18:15:00.000Z"); // today 00:00 NPT
    expect(spans[1][0]).toBe("2026-11-03T18:15:00.000Z"); // yesterday
    expect(spans[2][0]).toBe("2026-10-28T18:15:00.000Z"); // same weekday last week
    expect(buckets.usualBuckets).toEqual([2, 3, 4, 5]);
    expect(buckets.rows.map((r) => [r.bucket, r.counts.calls])).toEqual([[0, 10], [1, 20], [2, 30], [3, 40], [4, 50], [5, 60]]);
    expect(buckets.usualFroms).toHaveLength(4);
  });
  it("a failing span fails the load", async () => {
    const call = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(loadBuckets<OverviewJson>(ctxFor("today", "2026-11-05T06:00:00Z"), call, (d) => d.people)).rejects.toThrow("boom");
  });
});

describe("mergeFunnels", () => {
  const f = (entered: number, newLeads: number): OverviewJson => ({
    people: [],
    funnel: { stages: [{ list_id: "s", name: "S", slug: "s", sort_order: 1, is_archive: false, base: 9, entered: [entered, 0, 0, 0, 0], forward: [entered, 0, 0, 0, 0], out: [1, 0, 0, 0, 0], daily: [] }],
      new_leads: [newLeads, 0, 0, 0, 0], new_leads_daily: [], imported_excluded: 0, quality: { total: 0 } as never },
  });
  it("rebuilds per-window arrays from bucket 0 of each aligned call", () => {
    const m = mergeFunnels([f(1, 10), f(2, 20), f(3, 30), f(4, 40), f(5, 50), f(6, 60)]);
    expect(m.stages[0].entered).toEqual([1, 2, 3, 4, 5, 6]);
    expect(m.new_leads).toEqual([10, 20, 30, 40, 50, 60]);
  });
  it("a single (rolling) result passes through untouched", () => {
    const one = f(1, 10);
    expect(mergeFunnels([one])).toBe(one.funnel);
  });
});

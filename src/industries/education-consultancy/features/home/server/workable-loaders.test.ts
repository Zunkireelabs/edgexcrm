import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/queries", () => ({ getLeaveForHome: vi.fn(), resolveUserNames: vi.fn(async () => new Map()) }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: vi.fn() }));

import fs from "node:fs";
import path from "node:path";
import { loadQuietOverTwoWeeks } from "./quiet-leads";
import { loadMyLeads, type HomeDb } from "./load-home";
import { buildWorkablePlan } from "../lib/workable";
import type { ScopedLeads } from "./lead-scope";

const plan = buildWorkablePlan(["L1"], [{ pipeline_id: "P1", slug: "dropped", is_terminal: true }]);

function chain(log: unknown[][], result: unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "not", "is", "in", "eq", "or", "order", "limit", "neq"]) q[m] = (...a: unknown[]) => (log.push([m, ...a]), q);
  q.then = (res: (v: unknown) => unknown) => res(result);
  return q;
}

describe("loadQuietOverTwoWeeks", () => {
  it("counts only workable leads (exact head counts, filters not JS)", async () => {
    const log: unknown[][] = [];
    const leads: ScopedLeads = { definition: "tenant", select: (c, o) => (log.push(["scope", c, o]), chain(log, { count: 4 })) };
    const r = await loadQuietOverTwoWeeks(leads, plan, ["u1"], new Date("2026-11-07T00:00:00Z"), "UTC");
    expect(r.total).toBe(4);
    expect(log).toContainEqual(["scope", "id", { count: "exact", head: true }]);
    expect(log).toContainEqual(["in", "list_id", ["L1"]]);
    expect(log).toContainEqual(["or", "tags.is.null,tags.not.ov.{other,parent}"]);
    expect(log).toContainEqual(["or", 'status.is.null,status.not.in.("dropped")']);
    expect(log).toContainEqual(["or", "on_hold.is.null,on_hold.eq.false"]);
  });
  it("no active list: nothing", async () => {
    const leads: ScopedLeads = { definition: "tenant", select: () => { throw new Error("should not query"); } };
    expect(await loadQuietOverTwoWeeks(leads, buildWorkablePlan([], []), ["u1"], new Date(), "UTC")).toEqual({ total: 0, byPerson: [] });
  });
});

describe("loadMyLeads: isActive means workable", () => {
  it("won/lost, walk-in and on-hold leads are inactive; an ordinary lead is active", async () => {
    const base = { first_name: "A", last_name: "B", phone: null, assigned_at: null, created_at: "2026-11-01", last_touched_at: null, callback_due_at: null, on_hold: false, list_id: "L1", destinations: null, tags: ["student"], status: "new", pipeline_id: "P1", field_of_study: null, degree_level: null };
    const rows = [
      { ...base, id: "ok" },
      { ...base, id: "lost", status: "dropped" },
      { ...base, id: "walkin", tags: ["other"] },
      { ...base, id: "hold", on_hold: true },
    ];
    const tables: Record<string, unknown> = {
      leads: { data: rows, error: null },
      lead_lists: { data: [{ id: "L1", name: "Applications", sort_order: 1, is_archive: false, is_staging: false }], error: null },
      pipeline_stages: { data: [{ pipeline_id: "P1", slug: "dropped", is_terminal: true }], error: null },
    };
    const db = { from: (t: string) => chain([], tables[t] ?? { data: [] }) } as unknown as HomeDb;
    const { leads } = await loadMyLeads(db, "u1");
    expect(Object.fromEntries(leads.map((l) => [l.id, l.isActive]))).toEqual({ ok: true, lost: false, walkin: false, hold: false });
  });
});

describe("smart assignment Room count", () => {
  it("counts held leads through the shared helper (and not the old inline list filter)", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "assignment/engine.ts"), "utf8");
    expect(src).toMatch(/applyWorkable\(\s*db\.from\("leads"\)\.select\("id", \{ count: "exact", head: true \}\)\.eq\("assigned_to", m\.user_id\)/);
    expect(src).not.toMatch(/\.in\("list_id", lists\)/);
  });
});

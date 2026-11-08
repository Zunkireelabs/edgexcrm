import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/queries", () => ({ getLeaveForHome: vi.fn(), resolveUserNames: vi.fn(async () => new Map()) }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: vi.fn() }));

import fs from "node:fs";
import path from "node:path";
import { heldClauses, heldCutoff } from "@/lib/filters/held-cutoff";
import { quietContactClauses, quietContactCutoff } from "@/lib/filters/quiet-contact";
import { loadQuietOverTwoWeeks } from "./quiet-leads";
import { loadMyLeads, type HomeDb } from "./load-home";
import { buildWorkablePlan } from "../lib/workable";
import type { ScopedLeads } from "./lead-scope";

const plan = buildWorkablePlan(["L1"], [{ pipeline_id: "P1", slug: "dropped", is_terminal: true }]);

function chain(log: unknown[][], result: unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "not", "is", "in", "eq", "or", "order", "limit", "neq", "lt"]) q[m] = (...a: unknown[]) => (log.push([m, ...a]), q);
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
  it("uses the SAME quiet test as the no_contact_14d filter (shared clauses, tenant-day cutoff)", async () => {
    const log: unknown[][] = [];
    const leads: ScopedLeads = { definition: "tenant", select: (c, o) => (log.push(["scope", c, o]), chain(log, { count: 1 })) };
    const now = new Date("2026-11-08T19:00:00.000Z");
    await loadQuietOverTwoWeeks(leads, plan, [], now, "Asia/Kathmandu");
    const expected = quietContactClauses(quietContactCutoff(now, "Asia/Kathmandu")).join(",");
    expect(log).toContainEqual(["or", expected]);
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
    const { leads } = await loadMyLeads(db, "t1", "u1");
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

describe("loadUntouchedHeld: a lead counts only once it has been held 48 hours (click-through round 3, F)", () => {
  const now = new Date("2026-11-08T12:00:00.000Z");
  // Evaluates the two shared clauses the way PostgREST would, for one lead's assigned_at.
  const counts = (assignedAt: string | null) =>
    heldClauses(heldCutoff(now)).some((c) => (c === "assigned_at.is.null" ? assignedAt === null : assignedAt !== null && Date.parse(assignedAt) < Date.parse(c.replace("assigned_at.lt.", ""))));
  it("assigned 1 hour ago: not counted; 49 hours ago: counted; never stamped (null): counted", () => {
    expect(counts("2026-11-08T11:00:00.000Z")).toBe(false);
    expect(counts("2026-11-06T11:00:00.000Z")).toBe(true);
    expect(counts(null)).toBe(true);
  });
  it("the loader applies exactly those clauses", async () => {
    const { loadUntouchedHeld } = await import("./load-manager");
    const log: unknown[][] = [];
    const db = { from: () => chain(log, { data: [{ assigned_to: "u1" }], count: 1 }) } as unknown as HomeDb;
    const r = await loadUntouchedHeld(db, null, ["L1"], now);
    expect(r.count).toBe(1);
    expect(log).toContainEqual(["or", heldClauses(heldCutoff(now)).join(",")]);
  });
  it("the link's `held_48h` filter compiles the same clauses at the same cutoff", async () => {
    const { compileFilter } = await import("@/lib/filters/compile");
    const { leadFields } = await import("@/lib/filters/registry/leads");
    const ctx = { tz: "UTC", now, industryId: "education_consultancy", permissions: {} } as never;
    const sent: string[] = [];
    const b: Record<string, unknown> = new Proxy({}, { get: (_t, n: string) => (...a: unknown[]) => (sent.push(`${n}|${a.map(String).join("|")}`), b) });
    compileFilter(b as never, { conjunction: "and", conditions: [{ id: "h", field: "held_48h", op: "is_true" }] }, leadFields(ctx), ctx);
    for (const c of heldClauses(heldCutoff(now))) expect(sent.join("\n")).toContain(c);
  });
});

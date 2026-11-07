import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/scoped", () => ({ scopedClientForTenant: vi.fn() }));

import { loadAssignmentSettings, resolveFirstTouchPositions, type TenantDb } from "./settings";

function fakeDb(row: unknown, members: unknown[], leadCounts: Record<string, number>): TenantDb {
  const mk = (table: string) => {
    let user: string | null = null;
    const q: Record<string, unknown> = {};
    for (const m of ["select", "is", "gte"]) q[m] = () => q;
    q.eq = (_c: string, v: string) => ((user = v), q);
    q.maybeSingle = async () => ({ data: row, error: null });
    q.then = (res: (v: unknown) => unknown) => res(table === "tenant_users" ? { data: members } : { count: leadCounts[user ?? ""] ?? 0 });
    return q;
  };
  return { from: (t: string) => mk(t) } as unknown as TenantDb;
}

const members = [
  { user_id: "a", suspended_at: null, positions: { slug: "counselor", name: "Counselor" } },
  { user_id: "c", suspended_at: null, positions: { slug: "lead-executive", name: "Lead Executive" } },
  { user_id: "t", suspended_at: "2026-01-01", positions: { slug: "lead-caller", name: "TeleCaller" } },
];

describe("first-touch positions: saved, else learned", () => {
  it("never saved (NULL): learned from who received the new leads, not the old lead-caller default", async () => {
    const db = fakeDb({ mode: "shadow", first_touch_positions: null }, members, { a: 71, c: 33, t: 40 });
    const s = await loadAssignmentSettings(db);
    expect(s.positionsSaved).toBe(false);
    expect(await resolveFirstTouchPositions(db, s)).toEqual(["counselor", "lead-executive"]);
  });
  it("saved by the owner: used as is, nothing learned", async () => {
    const db = fakeDb({ mode: "auto", first_touch_positions: ["lead-caller"] }, members, { a: 71 });
    const s = await loadAssignmentSettings(db);
    expect(s.positionsSaved).toBe(true);
    expect(await resolveFirstTouchPositions(db, s)).toEqual(["lead-caller"]);
  });
  it("nothing to learn from (a brand-new tenant): falls back to the old default", async () => {
    const db = fakeDb(null, members, {});
    expect(await resolveFirstTouchPositions(db, await loadAssignmentSettings(db))).toEqual(["lead-caller"]);
  });
});

describe("engine: dormant filter input", () => {
  it("counts lead activity AND human notes in the last 14 days per pool member", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "engine.ts"), "utf8");
    expect(src).toContain("DORMANT_DAYS");
    expect(src).toMatch(/lead_activities"\)\.select\("id", \{ count: "exact", head: true \}\)\.eq\("user_id", m\.user_id\)\.gte\("created_at", since14d\)/);
    expect(src).toMatch(/lead_notes"\)\.select\("id", \{ count: "exact", head: true \}\)\.eq\("user_id", m\.user_id\)\.is\("ai_tool_call_id", null\)\.gte\("created_at", since14d\)/);
    expect(src).toContain("dormant: !(countBy.get(m.user_id)?.working ?? false)");
  });
});

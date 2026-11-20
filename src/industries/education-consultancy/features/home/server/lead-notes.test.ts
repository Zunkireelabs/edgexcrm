import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn() } }));

import { leadNotes, noteReadFailed } from "./lead-notes";
import type { HomeDb } from "./load-home";

// lead_notes has NO tenant_id column. The scoped client's from() appends .eq("tenant_id", ...) to every select, which makes
// PostgREST fail and a failed read looked like "zero notes" (active counsellors were flagged dormant). Notes are read through
// leadNotes(): the raw client, with the tenant enforced via the lead.
function walk(dir: string, out: string[] = []): string[] {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}

describe("lead_notes is never read through the tenant-injecting from()", () => {
  const home = path.resolve(__dirname, "..");
  const offenders = walk(home)
    .filter((f) => !f.endsWith(path.join("server", "lead-notes.ts")))
    .filter((f) => /\.from\(\s*["']lead_notes["']\s*\)/.test(fs.readFileSync(f, "utf8")))
    .map((f) => path.relative(home, f));
  it("no file under features/home calls .from(\"lead_notes\") directly", () => {
    expect(offenders).toEqual([]);
  });
});

describe("leadNotes", () => {
  it("reads through the raw client, embeds the lead, and filters that lead to the tenant", () => {
    const calls: unknown[][] = [];
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq"]) q[m] = (...a: unknown[]) => (calls.push([m, ...a]), q);
    const rawFrom = vi.fn(() => q);
    const scopedFrom = vi.fn();
    const db = { from: scopedFrom, raw: () => ({ from: rawFrom }) } as unknown as HomeDb;
    leadNotes(db, "t1", "user_id", { count: "exact", head: true });
    expect(rawFrom).toHaveBeenCalledWith("lead_notes");
    expect(scopedFrom).not.toHaveBeenCalled();
    expect(calls).toEqual([
      ["select", "user_id, leads!inner(tenant_id)", { count: "exact", head: true }],
      ["eq", "leads.tenant_id", "t1"],
    ]);
  });
});

describe("noteReadFailed", () => {
  it("reports a failed read (and logs it) instead of treating null as zero", () => {
    expect(noteReadFailed("x", { message: "boom" })).toBe(true);
    expect(noteReadFailed("x", null)).toBe(false);
  });
});

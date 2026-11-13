import { describe, expect, it } from "vitest";
import { compileFilter } from "./compile";
import { quietContactClauses, quietContactCutoff } from "./quiet-contact";
import { leadFields } from "./registry/leads";
import type { CompileCtx, FilterTree } from "./types";

const ctxFor = (tz: string, now: Date) => ({ tz, now, industryId: "education_consultancy", permissions: {} }) as unknown as CompileCtx;
const tree: FilterTree = { conjunction: "and", conditions: [{ id: "q", field: "no_contact_14d", op: "is_true" }] };

/** Records every builder call the compiler makes; returns the builder from every call. */
function recorder() {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const b: Record<string, unknown> = new Proxy({}, { get: (_t, name: string) => (...args: unknown[]) => (calls.push({ name, args }), b) });
  return { b, calls };
}

describe("quietContactCutoff — the tenant's day, not the server's", () => {
  // 2026-11-08 19:00 UTC is already 9 Nov 00:45 in Kathmandu (UTC+5:45) but still 8 Nov 14:00 in New York.
  const now = new Date("2026-11-08T19:00:00.000Z");
  it("Asia/Kathmandu: local midnight of (9 Nov - 14 days) = 26 Oct 00:00 +05:45", () => {
    expect(quietContactCutoff(now, "Asia/Kathmandu").toISOString()).toBe("2026-10-25T18:15:00.000Z");
  });
  it("America/New_York: the same instant is still 8 Nov there, so the cutoff is 25 Oct local midnight (EDT, UTC-4)", () => {
    expect(quietContactCutoff(now, "America/New_York").toISOString()).toBe("2026-10-25T04:00:00.000Z");
  });
  it("UTC: 8 Nov - 14 = 25 Oct 00:00Z; the three zones really do give three different instants", () => {
    const set = new Set(["Asia/Kathmandu", "America/New_York", "UTC"].map((z) => quietContactCutoff(now, z).toISOString()));
    expect(set.size).toBe(3);
  });
});

describe("the no_contact_14d filter and the shared clauses agree", () => {
  const now = new Date("2026-11-08T19:00:00.000Z");
  it("compiles to exactly the three OR-ed clauses Home's count uses, at the same cutoff", () => {
    const ctx = ctxFor("Asia/Kathmandu", now);
    const { b, calls } = recorder();
    compileFilter(b as never, tree, leadFields(ctx), ctx);
    const clauses = quietContactClauses(quietContactCutoff(now, "Asia/Kathmandu"));
    const sent = calls.map((c) => c.args.map(String).join("|")).join("\n");
    for (const c of clauses) expect(sent).toContain(c);
  });
  it("is an education-only field (hidden from other industries' registries)", () => {
    expect(leadFields(ctxFor("UTC", now)).no_contact_14d?.industries).toEqual(["education_consultancy"]);
  });
  it("the clauses are: touched before cutoff, OR never touched and handed over before it, OR never touched/handed and created before it", () => {
    const c = quietContactClauses(new Date("2026-10-25T18:15:00.000Z"));
    expect(c).toEqual([
      'last_touched_at.lt."2026-10-25T18:15:00.000Z"',
      'and(last_touched_at.is.null,assigned_at.lt."2026-10-25T18:15:00.000Z")',
      'and(last_touched_at.is.null,assigned_at.is.null,created_at.lt."2026-10-25T18:15:00.000Z")',
    ]);
  });
});

import { describe, it, expect } from "vitest";
import { decodeFilterTree } from "@/lib/filters/serialize";
import { compileFilter, planFilter } from "@/lib/filters/compile";
import type { CompileCtx } from "@/lib/filters/types";
import { leadFields } from "@/lib/filters/registry/leads";
import { leadsOfPersonHref, untouchedLeadsHref } from "./leads-links";

const UID = "11111111-1111-4111-8111-111111111111";

function treeOf(href: string) {
  const f = new URL(href, "http://x").searchParams.get("f")!;
  const res = decodeFilterTree(f);
  if (!res.ok) throw new Error(JSON.stringify(res.errors));
  return res.tree;
}

describe("leadsOfPersonHref — Reassign lands on exactly that person's leads", () => {
  it("is a real /leads link with a decodable ?f= tree", () => {
    const href = leadsOfPersonHref(UID);
    expect(href.startsWith("/leads?")).toBe(true);
    expect(treeOf(href).conditions).toEqual([{ id: "pulse:assignees", field: "assignees", op: "is_any_of", value: [UID] }]);
  });
  it("can stay inside a list tab", () => {
    expect(new URL(leadsOfPersonHref(UID, "pre-qualified"), "http://x").searchParams.get("list")).toBe("pre-qualified");
  });
  it("is a valid filter for the REAL leads registry (an unknown field would be reset with a toast = a dead end)", () => {
    const ctx = { tz: "Asia/Kathmandu", now: new Date("2026-11-05T00:00:00Z"), industryId: "education_consultancy", permissions: {} } as unknown as CompileCtx;
    const plan = planFilter(treeOf(leadsOfPersonHref(UID)), leadFields(ctx), ctx);
    expect(plan.ok).toBe(true);
  });
  it("compiles to a filter on assigned_to for exactly that id, and for nobody else", () => {
    const ctx = { tz: "Asia/Kathmandu", now: new Date("2026-11-05T00:00:00Z"), industryId: "education_consultancy", permissions: {} } as unknown as CompileCtx;
    const rec: string[] = [];
    const b: Record<string, unknown> = new Proxy({}, { get: (_t, name: string) => (...args: unknown[]) => { rec.push(`${name}(${args.map((a) => JSON.stringify(a)).join(",")})`); return b; } });
    compileFilter(b as never, treeOf(leadsOfPersonHref(UID)), leadFields(ctx), ctx);
    const joined = rec.join(" ");
    expect(joined).toContain("assigned_to");
    expect(joined).toContain(UID);
    expect(joined.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g)).toEqual([UID]);
  });
});

describe("untouchedLeadsHref — Reassign for the untouched signal lands on exactly that set", () => {
  const ctx = { tz: "Asia/Kathmandu", now: new Date("2026-11-05T12:00:00.000Z"), industryId: "education_consultancy", permissions: {} } as unknown as CompileCtx;
  it("is valid for the real registry", () => {
    const href = untouchedLeadsHref();
    expect(planFilter(treeOf(href), leadFields(ctx), ctx).ok).toBe(true);
  });
  it("compiles to no touch AND no stage move for 3+ days, not archived (the Pulse rule, any window)", () => {
    const rec: string[] = [];
    const b: Record<string, unknown> = new Proxy({}, { get: (_t, name: string) => (...args: unknown[]) => { rec.push(`${name}(${args.map((a) => JSON.stringify(a)).join(",")})`); return b; } });
    compileFilter(b as never, treeOf(untouchedLeadsHref()), leadFields(ctx), ctx);
    const joined = rec.join(" ");
    expect(joined).toContain("last_touched_at.is.null");
    expect(joined).toContain("last_touched_at.lt.");
    expect(joined).toContain("stage_changed_at.lt.\\\"2026-11-02T12:00:00.000Z"); // now − 3d exactly (the compiler quotes the timestamp)
    expect(joined).toContain("archived_at.is.null");
  });
  it("is hidden from other industries' registries", () => {
    const other = leadFields({ ...ctx, industryId: "it_agency" } as unknown as CompileCtx);
    expect(other["untouched_held"]?.industries).toEqual(["education_consultancy"]);
  });
});

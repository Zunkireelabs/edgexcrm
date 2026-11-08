import { describe, expect, it } from "vitest";
import { applyWorkable, buildWorkablePlan } from "@/industries/education-consultancy/features/home/lib/workable";
import { compileFilter, planFilter } from "./compile";
import { leadFields } from "./registry/leads";
import type { CompileCtx, FilterTree } from "./types";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
// "closed" is terminal in every pipeline; "done" only in P1 (open in P2); "x" only for the no-pipeline group.
const plan = buildWorkablePlan(["L1"], [
  { pipeline_id: P1, slug: "closed", is_terminal: true },
  { pipeline_id: P2, slug: "closed", is_terminal: true },
  { pipeline_id: P1, slug: "done", is_terminal: true },
  { pipeline_id: P2, slug: "done", is_terminal: false },
  { pipeline_id: null, slug: "x", is_terminal: true },
  { pipeline_id: P1, slug: "x", is_terminal: false },
]);
const ctx = { tz: "UTC", now: new Date("2026-11-08T00:00:00Z"), industryId: "education_consultancy", permissions: {} } as unknown as CompileCtx;
const value = JSON.stringify({ terminalEverywhere: plan.terminalEverywhere, terminalSome: plan.terminalSome });
const tree: FilterTree = { conjunction: "and", conditions: [{ id: "w", field: "workable", op: "is", value }] };

function recorder() {
  const calls: Array<[string, ...unknown[]]> = [];
  const b: Record<string, unknown> = new Proxy({}, { get: (_t, name: string) => (...args: unknown[]) => (calls.push([name, ...args]), b) });
  return { b, calls };
}

describe("the `workable` filter and applyWorkable share one clause builder", () => {
  const applied = recorder();
  applyWorkable(applied.b, plan);
  const filtered = recorder();
  compileFilter(filtered.b as never, tree, leadFields(ctx), ctx);
  const compiled = filtered.calls.map((c) => c.slice(1).map(String).join("|")).join("\n");

  // Each exclusion, taken from the path the COUNT uses, must appear in the path the LINK uses.
  const exclusions: Array<[string, (c: [string, ...unknown[]]) => boolean, string]> = [
    ["not deleted", (c) => c[0] === "is" && c[1] === "deleted_at", "deleted_at.is.null"],
    ["not archived", (c) => c[0] === "is" && c[1] === "archived_at", "archived_at.is.null"],
    ["not on hold", (c) => c[0] === "or" && String(c[1]).startsWith("on_hold"), "or(on_hold.is.null,on_hold.eq.false)"],
    ["not a walk-in (other / parent tags)", (c) => c[0] === "or" && String(c[1]).startsWith("tags."), "or(tags.is.null,tags.not.ov.{other,parent})"],
    ["terminal in every pipeline", (c) => c[0] === "or" && String(c[1]).includes('status.not.in.("closed")'), 'or(status.is.null,status.not.in.("closed"))'],
    ["terminal only in some pipelines (open in another)", (c) => c[0] === "or" && String(c[1]).includes('status.neq."done"'), `or(status.is.null,status.neq."done",pipeline_id.is.null,pipeline_id.not.in.(${P1}))`],
    ["terminal only for no-pipeline leads", (c) => c[0] === "or" && String(c[1]).includes('status.neq."x"'), 'or(status.is.null,status.neq."x",pipeline_id.not.is.null)'],
  ];
  it.each(exclusions)("%s: applied to the count AND compiled into the link", (_n, isIt, expected) => {
    expect(applied.calls.some(isIt)).toBe(true); // the count has it
    expect(compiled).toContain(expected); // so does the link, byte for byte
  });

  it("every `or` / `is` the count applies (except the list step) is in the link, and nothing extra", () => {
    const fromCount = applied.calls.filter((c) => c[0] === "is" || c[0] === "or").map((c) => (c[0] === "is" ? `${c[1]}.is.null` : `or(${c[1]})`));
    for (const clause of fromCount) expect(compiled).toContain(clause);
    // 2 is-null + 1 on-hold + 1 tags + 1 terminal-everywhere + 2 terminal-some
    expect(fromCount).toHaveLength(7);
  });

  it("is an education-only field hidden from the picker but usable from a URL", () => {
    const f = leadFields(ctx).workable;
    expect(f.industries).toEqual(["education_consultancy"]);
    expect(f.hiddenFromPicker).toBe(true);
    expect(f.filterable).toBe(true);
    expect(planFilter(tree, leadFields(ctx), ctx).ok).toBe(true);
  });

  it("a hostile or garbled terminal plan is ignored: none of its text reaches the filter, the base exclusions still apply", () => {
    const hostile = (v: unknown): FilterTree => ({ conjunction: "and", conditions: [{ id: "w", field: "workable", op: "is", value: typeof v === "string" ? v : JSON.stringify(v) }] });
    for (const v of [
      { terminalEverywhere: ['x"),deleted_at.is.null,("'], terminalSome: [] },
      { terminalEverywhere: [], terminalSome: [{ slug: "ok", pipelineIds: ["P1,id.eq.1"] }] },
      "not json",
      "null",
      { terminalEverywhere: "nope" },
    ]) {
      const r = recorder();
      compileFilter(r.b as never, hostile(v), leadFields(ctx), ctx);
      const s = r.calls.map((c) => c.slice(1).map(String).join("|")).join("\n");
      expect(s).not.toContain("id.eq.1");
      expect(s).not.toContain("deleted_at.is.null,(");
      expect(s).not.toContain("status");
      expect(s).toContain("archived_at.is.null");
    }
  });

  it("a tenant with no terminal stages still excludes archived, on-hold and walk-in leads", () => {
    const r = recorder();
    compileFilter(r.b as never, { conjunction: "and", conditions: [{ id: "w", field: "workable", op: "is", value: JSON.stringify({ terminalEverywhere: [], terminalSome: [] }) }] }, leadFields(ctx), ctx);
    const s = r.calls.map((c) => c.slice(1).map(String).join("|")).join("\n");
    expect(s).toContain("archived_at.is.null");
    expect(s).toContain("on_hold.eq.false");
    expect(s).toContain("tags.not.ov");
    expect(s).not.toContain("status");
  });
});

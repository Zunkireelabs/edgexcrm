import { describe, expect, it } from "vitest";
import { applyWorkable, buildWorkablePlan, isWorkable, type StageRow } from "./workable";

const stages: StageRow[] = [
  { pipeline_id: "P1", slug: "new", is_terminal: false },
  { pipeline_id: "P1", slug: "closed", is_terminal: true },
  { pipeline_id: "P2", slug: "closed", is_terminal: true },
  { pipeline_id: "P1", slug: "dropped", is_terminal: true },
  { pipeline_id: "P1", slug: "won", is_terminal: true },
  // "done" is terminal in P1 but an ordinary open stage in P2: ambiguous across pipelines.
  { pipeline_id: "P1", slug: "done", is_terminal: true },
  { pipeline_id: "P2", slug: "done", is_terminal: false },
];
const plan = buildWorkablePlan(["L1", "L2"], stages);
const lead = { list_id: "L1", status: "new", pipeline_id: "P1" };

describe("buildWorkablePlan", () => {
  it("terminal in every pipeline that has the slug -> plain list", () => {
    expect(plan.terminalEverywhere).toEqual(["closed", "dropped", "won"]);
  });
  it("terminal in some pipelines only -> handled per pipeline, never guessed", () => {
    expect(plan.terminalSome).toEqual([{ slug: "done", pipelineIds: ["P1"] }]);
  });
  it("a slug that is never terminal appears nowhere", () => {
    expect([...plan.terminalEverywhere, ...plan.terminalSome.map((t) => t.slug)]).not.toContain("new");
  });
});

describe("isWorkable", () => {
  it("an ordinary open lead in an active list is workable", () => expect(isWorkable(lead, plan)).toBe(true));
  it("a lead with no list counts as active (as before)", () => expect(isWorkable({ ...lead, list_id: null }, plan)).toBe(true));
  it.each([
    ["deleted", { deleted_at: "2026-11-01" }],
    ["archived", { archived_at: "2026-11-01" }],
    ["on hold", { on_hold: true }],
    ["in an archive / staging list", { list_id: "L-arch" }],
    ["a walk-in (other)", { tags: ["other"] }],
    ["a retired parent contact", { tags: ["student", "parent"] }],
    ["terminal won", { status: "won" }],
    ["terminal lost", { status: "dropped" }],
  ])("%s is not workable", (_n, patch) => {
    expect(isWorkable({ ...lead, ...patch }, plan)).toBe(false);
  });
  it("a student-tagged lead is fine", () => expect(isWorkable({ ...lead, tags: ["student"] }, plan)).toBe(true));
  it("a re-opened lead (terminal -> open) counts again", () => {
    expect(isWorkable({ ...lead, status: "dropped" }, plan)).toBe(false);
    expect(isWorkable({ ...lead, status: "new" }, plan)).toBe(true);
  });
  it("a slug terminal in one pipeline and open in another: decided by the lead's own pipeline", () => {
    expect(isWorkable({ ...lead, status: "done", pipeline_id: "P1" }, plan)).toBe(false);
    expect(isWorkable({ ...lead, status: "done", pipeline_id: "P2" }, plan)).toBe(true);
    expect(isWorkable({ ...lead, status: "done", pipeline_id: null }, plan)).toBe(true);
  });
  it("no status is workable", () => expect(isWorkable({ ...lead, status: null }, plan)).toBe(true));
});

/** Records every filter call, in order. */
function recorder() {
  const calls: unknown[][] = [];
  const q: Record<string, unknown> = {};
  for (const m of ["is", "or", "in"]) q[m] = (...a: unknown[]) => (calls.push([m, ...a]), q);
  return { q, calls };
}

describe("applyWorkable (the same definition as PostgREST filters, so counts stay exact)", () => {
  it("applies every exclusion", () => {
    const { q, calls } = recorder();
    expect(applyWorkable(q, plan)).toBe(q);
    expect(calls).toEqual([
      ["is", "deleted_at", null],
      ["is", "archived_at", null],
      ["or", "on_hold.is.null,on_hold.eq.false"],
      ["in", "list_id", ["L1", "L2"]],
      ["or", "tags.is.null,tags.not.ov.{other,parent}"],
      ["or", 'status.is.null,status.not.in.("closed","dropped","won")'],
      ["or", 'status.is.null,status.neq."done",pipeline_id.is.null,pipeline_id.not.in.(P1)'],
    ]);
  });
  it("a tenant with no terminal stages adds no status filter", () => {
    const { q, calls } = recorder();
    applyWorkable(q, buildWorkablePlan(["L1"], [{ pipeline_id: "P1", slug: "new", is_terminal: false }]));
    expect(calls.some((c) => String(c[1]).includes("status"))).toBe(false);
  });
  it("no active list can never mean 'every list'", () => {
    const { q, calls } = recorder();
    applyWorkable(q, buildWorkablePlan([], []));
    expect(calls).toContainEqual(["in", "list_id", ["00000000-0000-0000-0000-000000000000"]]);
  });
  it("a slug terminal only for the no-pipeline group is handled too", () => {
    const { q, calls } = recorder();
    applyWorkable(q, buildWorkablePlan(["L1"], [{ pipeline_id: null, slug: "x", is_terminal: true }, { pipeline_id: "P1", slug: "x", is_terminal: false }]));
    expect(calls).toContainEqual(["or", 'status.is.null,status.neq."x",pipeline_id.not.is.null']);
  });
});

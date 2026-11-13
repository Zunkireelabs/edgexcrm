import { describe, expect, it } from "vitest";
import { encodeFilterTree } from "@/lib/filters/serialize";
import type { CompileCtx, FilterTree } from "@/lib/filters/types";
import { ageTone, STUCK_DAYS } from "./card-metrics";
import {
  computeTabCounts,
  decodeApplicationParams,
  parseSort,
  parseTab,
  withParam,
  withPipelineSwitch,
  withSearchCondition,
} from "./applications-url";

const ctx: CompileCtx = { tz: "UTC", now: new Date("2026-01-15T12:00:00.000Z"), industryId: "education_consultancy", permissions: {} };
const U = "11111111-1111-4111-8111-111111111111";
const tree: FilterTree = {
  conjunction: "and",
  conditions: [
    { id: "a", field: "counsellor", op: "is_any_of", value: [U] },
    { id: "b", field: "stage", op: "is_any_of", value: [U] },
    { id: "c", field: "intake", op: "is", value: "Fall 2026" },
  ],
};

describe("URL round trip", () => {
  it("f, q, sort, tab decode from the params the toolbar writes", () => {
    const d = decodeApplicationParams({ f: encodeFilterTree(tree), q: " harvard ", sort: "deadline", tab: "stuck", pipeline: "p1" }, ctx);
    expect(d.tree).toEqual(tree);
    expect(d).toMatchObject({ q: "harvard", sort: "deadline", tab: "stuck", filterError: null });
  });
  it("unknown values fall back to defaults", () => {
    expect(parseTab("nope")).toBe("all");
    expect(parseSort("nope")).toBe("stage");
    expect(decodeApplicationParams({}, ctx)).toMatchObject({ q: "", sort: "stage", tab: "all", filterError: null });
  });
  it("an invalid ?f= does not throw: empty tree plus a message", () => {
    for (const bad of ["%%%", "e30", encodeFilterTree({ conjunction: "and", conditions: [] }).slice(0, 3)]) {
      expect(() => decodeApplicationParams({ f: bad }, ctx)).not.toThrow();
    }
    const d = decodeApplicationParams({ f: "not base64 {{" }, ctx);
    expect(d.tree.conditions).toEqual([]);
    expect(d.filterError).toMatch(/couldn't be read/);
  });
  it("a stale field key is dropped, the rest kept", () => {
    const stale: FilterTree = { conjunction: "and", conditions: [{ id: "x", field: "gone", op: "is_empty" }, tree.conditions[2]] };
    const d = decodeApplicationParams({ f: encodeFilterTree(stale) }, ctx);
    expect(d.tree.conditions.map((c) => c.field)).toEqual(["intake"]);
    expect(d.filterError).toMatch(/no longer exist/);
  });
  it("withParam sets and deletes", () => {
    expect(withParam("a=1", "tab", "mine")).toBe("a=1&tab=mine");
    expect(withParam("a=1&tab=mine", "tab", null)).toBe("a=1");
  });
});

describe("switching pipeline", () => {
  it("keeps chips, drops the Stage condition", () => {
    const qs = withPipelineSwitch(`f=${encodeFilterTree(tree)}&q=x&tab=mine`, "p2");
    const p = new URLSearchParams(qs);
    expect(p.get("pipeline")).toBe("p2");
    expect(p.get("q")).toBe("x");
    expect(p.get("tab")).toBe("mine");
    const d = decodeApplicationParams({ f: p.get("f") ?? undefined }, ctx);
    expect(d.tree.conditions.map((c) => c.field)).toEqual(["counsellor", "intake"]);
  });
  it("removes ?f= entirely when Stage was the only chip", () => {
    const only: FilterTree = { conjunction: "and", conditions: [tree.conditions[1]] };
    expect(new URLSearchParams(withPipelineSwitch(`f=${encodeFilterTree(only)}`, "p2")).has("f")).toBe(false);
  });
});

describe("search folds into the tree", () => {
  it("adds a top-level search condition; keeps an OR tree as a group", () => {
    expect(withSearchCondition(tree, " ").conditions).toHaveLength(3);
    expect(withSearchCondition(tree, "har").conditions.at(-1)).toMatchObject({ field: "search", value: "har" });
    const or: FilterTree = { conjunction: "or", conditions: [tree.conditions[2]] };
    const t = withSearchCondition(or, "har");
    expect(t.conjunction).toBe("and");
    expect(t.groups?.[0].conjunction).toBe("or");
  });
});

describe("header + tab counts", () => {
  const day = 86_400_000;
  const now = Date.parse("2026-01-15T12:00:00.000Z");
  const ago = (d: number) => new Date(now - d * day).toISOString();
  const apps = [
    { id: "1", stage_id: "s1", stage_changed_at: ago(40), assigned_to: "me", leads: null },
    { id: "2", stage_id: "s1", stage_changed_at: ago(5), assigned_to: null, leads: { assigned_to: "me" } },
    { id: "3", stage_id: "done", stage_changed_at: ago(90), assigned_to: "x", leads: null },
    { id: "4", stage_id: "s1", stage_changed_at: ago(60), assigned_to: "x", leads: null },
    { id: "5", stage_id: "s9", stage_changed_at: ago(60), assigned_to: "me", leads: null }, // other pipeline
  ];
  const placements = new Map(apps.map((a) => [a.id, { pipelineId: a.id === "5" ? "p2" : "p1", stageId: a.stage_id }]));
  it("counts all / mine (effective counsellor) / stuck (not finished) inside the selected pipeline only", () => {
    expect(computeTabCounts(apps, placements, "p1", new Set(["done"]), "me", now)).toEqual({ all: 4, mine: 2, stuck: 2 });
    expect(computeTabCounts(apps, placements, "p2", new Set(), "me", now)).toEqual({ all: 1, mine: 1, stuck: 1 });
  });
  it("the Stuck tab and the red age pill share one threshold", () => {
    expect(STUCK_DAYS).toBe(30);
    expect(ageTone(STUCK_DAYS, false)).toBe("red");
    expect(ageTone(STUCK_DAYS - 1, false)).not.toBe("red");
  });
});

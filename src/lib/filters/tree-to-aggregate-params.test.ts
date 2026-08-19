import { describe, it, expect } from "vitest";
import { treeToAggregateParams } from "./tree-to-aggregate-params";
import { leadFields } from "./registry/leads";
import { addCalendarUnitsUTC } from "./date-math";
import type { CompileCtx, FilterCondition, FilterTree } from "./types";

const ctx: CompileCtx = { tz: "UTC", now: new Date("2026-08-07T00:00:00Z"), industryId: null, permissions: {} };
const registry = leadFields(ctx);
const NOW = new Date("2026-08-07T12:00:00Z");

function tree(conditions: FilterCondition[], extra: Partial<FilterTree> = {}): FilterTree {
  return { conjunction: "and", conditions, ...extra };
}

function cond(field: string, op: FilterCondition["op"], value?: FilterCondition["value"]): FilterCondition {
  return { id: field, field, op, value };
}

describe("treeToAggregateParams", () => {
  it("maps a pure-AND tree of expressible conditions", () => {
    const result = treeToAggregateParams(
      tree([
        cond("status", "is", "new"),
        cond("assignees", "is_any_of", ["11111111-1111-1111-1111-111111111111", "unassigned"]),
        cond("tags", "has_all", ["student"]),
        cond("industry", "is", "software"),
        cond("form", "is", "22222222-2222-2222-2222-222222222222"),
      ]),
      registry,
      NOW
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.params).toEqual({
      status: "new",
      assigneesAny: ["11111111-1111-1111-1111-111111111111"],
      includeUnassigned: true,
      tag: "student",
      prospectIndustry: "software",
      formConfigId: "22222222-2222-2222-2222-222222222222",
    });
  });

  it("maps created within_last to a createdAfter date", () => {
    const result = treeToAggregateParams(tree([cond("created", "within_last", "7d")]), registry, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.params.createdAfter?.toISOString()).toBe(new Date("2026-07-31T12:00:00Z").toISOString());
  });

  it("maps created after to a createdAfter date", () => {
    const result = treeToAggregateParams(tree([cond("created", "after", "2026-01-01")]), registry, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.params.createdAfter?.toISOString()).toBe(new Date("2026-01-01").toISOString());
  });

  it("maps collaborators is_any_of to collaboratorIds", () => {
    const result = treeToAggregateParams(
      tree([cond("collaborators", "is_any_of", ["33333333-3333-3333-3333-333333333333"])]),
      registry,
      NOW
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.params.collaboratorIds).toEqual(["33333333-3333-3333-3333-333333333333"]);
  });

  it("rejects a root OR conjunction", () => {
    const result = treeToAggregateParams(tree([cond("status", "is", "new")], { conjunction: "or" }), registry, NOW);
    expect(result.ok).toBe(false);
  });

  it("rejects a tree with OR sub-groups", () => {
    const result = treeToAggregateParams(
      tree([cond("status", "is", "new")], { groups: [{ conjunction: "or", conditions: [cond("status", "is", "contacted")] }] }),
      registry,
      NOW
    );
    expect(result.ok).toBe(false);
  });

  it("rejects contains — no lead_aggregates() equivalent", () => {
    const result = treeToAggregateParams(tree([cond("search", "contains", "jane")]), registry, NOW);
    expect(result.ok).toBe(false);
  });

  it("rejects is_empty on any field", () => {
    const result = treeToAggregateParams(tree([cond("industry", "is_empty")]), registry, NOW);
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown field", () => {
    const result = treeToAggregateParams(tree([cond("phone", "is", "123")]), registry, NOW);
    expect(result.ok).toBe(false);
  });

  it("rejects status is_not — no p_status_ne on the RPC", () => {
    const result = treeToAggregateParams(tree([cond("status", "is_not", "new")]), registry, NOW);
    expect(result.ok).toBe(false);
  });

  it("rejects a multi-tag has_all — only single-tag is expressible", () => {
    const result = treeToAggregateParams(tree([cond("tags", "has_all", ["student", "vip"])]), registry, NOW);
    expect(result.ok).toBe(false);
  });

  it("rejects a duplicate condition on the same aggregate axis", () => {
    const result = treeToAggregateParams(
      tree([cond("status", "is", "new"), cond("status", "is", "contacted")]),
      registry,
      NOW
    );
    expect(result.ok).toBe(false);
  });

  it("returns ok:true with empty params for an empty tree", () => {
    const result = treeToAggregateParams(tree([]), registry, NOW);
    expect(result).toEqual({ ok: true, params: {} });
  });

  it("month/year-unit within_last agrees EXACTLY with compile.ts's shared date-math — the facet-count badge and the actual query must compute the same instant, not just 'close enough'", () => {
    // Before date-math.ts was extracted and shared, this file computed
    // within_last in the server process's LOCAL timezone (setMonth/
    // setFullYear) while compile.ts computed it in UTC (setUTCMonth/
    // setUTCFullYear) — the two could silently disagree by up to a day.
    // Asserting equality against date-math.ts directly (not a hardcoded
    // string) means this test fails the moment the two ever diverge again.
    const monthResult = treeToAggregateParams(tree([cond("created", "within_last", "3m")]), registry, NOW);
    expect(monthResult.ok).toBe(true);
    if (monthResult.ok) {
      expect(monthResult.params.createdAfter?.toISOString()).toBe(addCalendarUnitsUTC(NOW, -3, "m").toISOString());
    }

    const yearResult = treeToAggregateParams(tree([cond("created", "within_last", "1y")]), registry, NOW);
    expect(yearResult.ok).toBe(true);
    if (yearResult.ok) {
      expect(yearResult.params.createdAfter?.toISOString()).toBe(addCalendarUnitsUTC(NOW, -1, "y").toISOString());
    }
  });

  it("clamps day-of-month on an end-of-month date instead of overflowing (matches compile.ts's guard against the same bug)", () => {
    const mar31 = new Date("2026-03-31T12:00:00Z");
    const result = treeToAggregateParams(tree([cond("created", "within_last", "1m")]), registry, mar31);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.params.createdAfter?.toISOString()).toBe("2026-02-28T12:00:00.000Z");
  });
});

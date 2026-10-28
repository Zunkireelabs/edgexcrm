import { describe, it, expect } from "vitest";
import { prepareSavedFilterTree } from "./apply-saved-filter";
import { leadFields } from "@/lib/filters/registry/leads";
import type { CompileCtx, FilterTree } from "@/lib/filters/types";

const ctx: CompileCtx = { tz: "UTC", now: new Date(0), industryId: "education_consultancy", permissions: {} };
const registry = leadFields(ctx);

const tree: FilterTree = {
  conjunction: "and",
  conditions: [
    { id: "old-1", field: "assignees", op: "is_any_of", value: ["u1"] },
    { id: "old-2", field: "status", op: "is_any_of", value: ["connected", "in_progress"] },
  ],
};

describe("prepareSavedFilterTree", () => {
  it("keeps every condition and gives each a fresh id (a saved id could clash with a chip already on screen)", () => {
    const { tree: out, dropped } = prepareSavedFilterTree(tree, registry);
    expect(dropped).toBe(0);
    expect(out.conditions.map((c) => c.field)).toEqual(["assignees", "status"]);
    expect(out.conditions.map((c) => c.id)).not.toContain("old-1");
    expect(new Set(out.conditions.map((c) => c.id)).size).toBe(2);
    expect(out.conditions[1].value).toEqual(["connected", "in_progress"]);
  });

  it("drops conditions on fields that no longer exist and counts them, instead of failing the whole filter", () => {
    const withGhost: FilterTree = {
      conjunction: "and",
      conditions: [...tree.conditions, { id: "old-3", field: "removed_field", op: "is", value: "x" }],
    };
    const { tree: out, dropped } = prepareSavedFilterTree(withGhost, registry);
    expect(dropped).toBe(1);
    expect(out.conditions.map((c) => c.field)).toEqual(["assignees", "status"]);
  });

  it("returns an empty tree when nothing in the saved filter still exists", () => {
    const { tree: out, dropped } = prepareSavedFilterTree(
      { conjunction: "and", conditions: [{ id: "a", field: "gone", op: "is", value: "x" }] },
      registry,
    );
    expect(dropped).toBe(1);
    expect(out.conditions).toEqual([]);
  });

  it("cleans OR groups too and removes a group that ends up empty", () => {
    const grouped: FilterTree = {
      conjunction: "and",
      conditions: [],
      groups: [
        { conjunction: "or", conditions: [{ id: "g1", field: "status", op: "is", value: "connected" }] },
        { conjunction: "or", conditions: [{ id: "g2", field: "gone", op: "is", value: "x" }] },
      ],
    };
    const { tree: out, dropped } = prepareSavedFilterTree(grouped, registry);
    expect(dropped).toBe(1);
    expect(out.groups).toHaveLength(1);
    expect(out.groups![0].conditions[0].id).not.toBe("g1");
  });
});

import { describe, it, expect } from "vitest";
import { treeForFacetOption } from "./facet-tree";
import type { FilterTree } from "./types";

const status = { id: "s", field: "status", op: "is" as const, value: "new" };
const collabs = { id: "c", field: "collaborators", op: "is_any_of" as const, value: ["a", "b"] };

describe("treeForFacetOption", () => {
  it("replaces the facet's own axis with the single option and keeps every other condition", () => {
    const tree: FilterTree = { conjunction: "and", conditions: [status, collabs] };
    const out = treeForFacetOption(tree, "collaborators", "x");
    expect(out?.conditions).toEqual([status, { id: "facet:collaborators", field: "collaborators", op: "is_any_of", value: ["x"] }]);
  });

  it("adds the option when the axis wasn't filtered yet", () => {
    const out = treeForFacetOption({ conjunction: "and", conditions: [status] }, "assignees", "unassigned");
    expect(out?.conditions).toHaveLength(2);
    expect(out?.conditions[1]).toMatchObject({ field: "assignees", value: ["unassigned"] });
  });

  it("keeps OR sub-groups untouched (dropping one OR branch would change its meaning)", () => {
    const group = { conjunction: "or" as const, conditions: [collabs, status] };
    const out = treeForFacetOption({ conjunction: "and", conditions: [], groups: [group] }, "collaborators", "x");
    expect(out?.groups).toEqual([group]);
    expect(out?.conditions).toHaveLength(1);
  });

  it("returns null for a top-level OR tree — no faithful expression, so no number", () => {
    expect(treeForFacetOption({ conjunction: "or", conditions: [status] }, "collaborators", "x")).toBeNull();
  });

  it("does not mutate the input tree", () => {
    const tree: FilterTree = { conjunction: "and", conditions: [status, collabs] };
    treeForFacetOption(tree, "collaborators", "x");
    expect(tree.conditions).toEqual([status, collabs]);
  });
});

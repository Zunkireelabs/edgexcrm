import { describe, it, expect } from "vitest";
import { createSavedFilterSchema, renameSavedFilterSchema, MAX_SAVED_FILTER_NAME_LENGTH } from "./saved-filter-schema";

const goodTree = {
  conjunction: "and",
  conditions: [{ id: "c1", field: "status", op: "is_any_of", value: ["connected", "in_progress"] }],
};

describe("saved filter validation", () => {
  it("accepts a name and a real filter tree, and trims the name", () => {
    const r = createSavedFilterSchema.safeParse({ name: "  Amit — Prospects  ", filter_tree: goodTree });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Amit — Prospects");
  });

  it("rejects a blank or whitespace-only name", () => {
    expect(createSavedFilterSchema.safeParse({ name: "   ", filter_tree: goodTree }).success).toBe(false);
    expect(renameSavedFilterSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("rejects a name that is too long", () => {
    const name = "x".repeat(MAX_SAVED_FILTER_NAME_LENGTH + 1);
    expect(createSavedFilterSchema.safeParse({ name, filter_tree: goodTree }).success).toBe(false);
  });

  it("rejects an empty filter — there is nothing to save", () => {
    const r = createSavedFilterSchema.safeParse({ name: "Empty", filter_tree: { conjunction: "and", conditions: [] } });
    expect(r.success).toBe(false);
  });

  it("rejects a malformed tree (unknown operator)", () => {
    const bad = { conjunction: "and", conditions: [{ id: "c1", field: "status", op: "nonsense", value: "x" }] };
    expect(createSavedFilterSchema.safeParse({ name: "Bad", filter_tree: bad }).success).toBe(false);
  });

  it("rejects a missing tree", () => {
    expect(createSavedFilterSchema.safeParse({ name: "No tree" }).success).toBe(false);
  });
});

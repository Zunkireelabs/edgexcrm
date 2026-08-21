// Regression guard for SMS-FIX-F13 (docs/SMS-PHASE4-FIX-F13-BRIEF.md): the
// persistent audience-count chip needs to preview an in-progress draft
// condition (still open in its filter popover, not yet Applied) by folding
// it into the committed tree. withDraft() is the pure merge function that
// does that — replace-by-id when the draft edits an existing chip, append
// when it's a brand-new AddFilterButton draft.

import { describe, it, expect } from "vitest";
import { withDraft } from "./blast-composer";
import type { FilterCondition, FilterTree } from "@/lib/filters/types";

const BASE_TREE: FilterTree = {
  conjunction: "and",
  conditions: [{ id: "cond-1", field: "status", op: "is", value: "new" }],
};

describe("withDraft — F-13 fix", () => {
  it("returns the tree unchanged when draft is null", () => {
    expect(withDraft(BASE_TREE, null)).toBe(BASE_TREE);
  });

  it("appends a draft with a fresh id (AddFilterButton case)", () => {
    const draft: FilterCondition = { id: "cond-new", field: "source", op: "is", value: "Facebook Ad" };
    const result = withDraft(BASE_TREE, draft);
    expect(result.conditions).toEqual([BASE_TREE.conditions[0], draft]);
  });

  it("replaces the condition in place when the draft id already exists (FilterChip case)", () => {
    const draft: FilterCondition = { id: "cond-1", field: "status", op: "is", value: "contacted" };
    const result = withDraft(BASE_TREE, draft);
    expect(result.conditions).toEqual([draft]);
  });

  it("preserves conjunction and other tree fields untouched", () => {
    const draft: FilterCondition = { id: "cond-new", field: "source", op: "is", value: "Walk-in" };
    const result = withDraft({ ...BASE_TREE, conjunction: "or" }, draft);
    expect(result.conjunction).toBe("or");
  });
});

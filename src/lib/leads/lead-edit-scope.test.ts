import { describe, it, expect } from "vitest";
import { canEditLeadWorkingData } from "./lead-edit-scope";

// Regression guard for the 2026-09-25 bug: a branch manager (leadScope
// "team") could move/reassign a lead but couldn't edit its Study Interest
// or Lead Source fields, because those two panels' edit gates never checked
// leadScope at all — only isAdmin (Lead Source) or isAdmin/assignee/
// collaborator (Study Interest). Every "can edit this lead's working data"
// gate must route through this one function so that can't drift again.
describe("canEditLeadWorkingData", () => {
  it("grants access to an admin regardless of scope or own-scope status", () => {
    expect(canEditLeadWorkingData({ isAdmin: true, leadScope: "own", isOwnScopeEditor: false })).toBe(true);
    expect(canEditLeadWorkingData({ isAdmin: true, leadScope: undefined, isOwnScopeEditor: false })).toBe(true);
  });

  it("grants access to a branch manager (leadScope: team) even with no own-scope right", () => {
    expect(canEditLeadWorkingData({ isAdmin: false, leadScope: "team", isOwnScopeEditor: false })).toBe(true);
  });

  it("grants access via isOwnScopeEditor for a non-admin, non-team caller", () => {
    expect(canEditLeadWorkingData({ isAdmin: false, leadScope: "own", isOwnScopeEditor: true })).toBe(true);
  });

  it("denies access to a plain member with own-scope who isn't the lead's editor", () => {
    expect(canEditLeadWorkingData({ isAdmin: false, leadScope: "own", isOwnScopeEditor: false })).toBe(false);
  });

  it("isOwnScopeEditor defaults to false when omitted", () => {
    expect(canEditLeadWorkingData({ isAdmin: false, leadScope: "all" })).toBe(false);
  });
});

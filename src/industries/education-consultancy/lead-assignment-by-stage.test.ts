import { describe, it, expect } from "vitest";
import { isAssigneePermittedForStage } from "./lead-assignment-by-stage";

// Server-side guard for manual dashboard creates: who may be assigned a lead created into a stage.
describe("isAssigneePermittedForStage", () => {
  const base = { stageSlug: "prospects", assigneeId: "u-1", assigneeRole: "member", assigneeSlug: "counselor" };

  it("a position that works the stage is permitted", () => {
    expect(isAssigneePermittedForStage(base)).toBe(true);
    expect(isAssigneePermittedForStage({ ...base, assigneeSlug: "branch-manager" })).toBe(true);
  });

  it("a position from a different stage is not", () => {
    expect(isAssigneePermittedForStage({ ...base, assigneeSlug: "lead-caller" })).toBe(false);
  });

  it("admins are always permitted", () => {
    expect(isAssigneePermittedForStage({ ...base, assigneeRole: "admin", assigneeSlug: "lead-caller" })).toBe(true);
  });

  it("the manager of the lead's branch is permitted even without a stage position", () => {
    const wrong = { ...base, assigneeSlug: "lead-caller" };
    expect(isAssigneePermittedForStage({ ...wrong, branchManagerId: "u-1" })).toBe(true);
    expect(isAssigneePermittedForStage({ ...wrong, branchManagerId: "someone-else" })).toBe(false);
  });

  it("a branch with no manager (the Global inbox) never grants the fallback", () => {
    const wrong = { ...base, assigneeSlug: "lead-caller" };
    expect(isAssigneePermittedForStage({ ...wrong, branchManagerId: null })).toBe(false);
    expect(isAssigneePermittedForStage({ ...wrong })).toBe(false);
  });

  it("an unknown stage allows no position; a missing position slug is not permitted by position", () => {
    expect(isAssigneePermittedForStage({ ...base, stageSlug: "staging" })).toBe(false);
    expect(isAssigneePermittedForStage({ ...base, assigneeSlug: null })).toBe(false);
  });
});

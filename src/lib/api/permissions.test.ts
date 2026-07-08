import { describe, it, expect } from "vitest";
import { resolveEffectiveBranch } from "./permissions";

describe("resolveEffectiveBranch", () => {
  const validBranchIds = ["branch-1", "branch-2"];

  it("returns the cookie value when it is a real branch id for this tenant", () => {
    expect(resolveEffectiveBranch("branch-1", validBranchIds)).toBe("branch-1");
  });

  it("returns null when the cookie value is not in the tenant's branch ids (stale/other-tenant cookie)", () => {
    expect(resolveEffectiveBranch("stale-branch-id", validBranchIds)).toBeNull();
  });

  it('returns null for the "all" sentinel', () => {
    expect(resolveEffectiveBranch("all", validBranchIds)).toBeNull();
  });

  it('returns null for the "overall" sentinel', () => {
    expect(resolveEffectiveBranch("overall", validBranchIds)).toBeNull();
  });

  it("returns null when the cookie value is null", () => {
    expect(resolveEffectiveBranch(null, validBranchIds)).toBeNull();
  });

  it("returns null when the cookie value is undefined", () => {
    expect(resolveEffectiveBranch(undefined, validBranchIds)).toBeNull();
  });

  it("returns null when the cookie value is an empty string", () => {
    expect(resolveEffectiveBranch("", validBranchIds)).toBeNull();
  });

  it("returns null when validBranchIds is empty (single-branch tenant)", () => {
    expect(resolveEffectiveBranch("branch-1", [])).toBeNull();
  });
});

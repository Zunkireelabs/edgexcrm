import { describe, it, expect } from "vitest";
import { canActOnEnrollmentLead, type EnrollmentScopeSubject } from "./enrollment-scope";

// The one rule the enrollment API enforces and the Classes page uses to pre-flag each student.
// Pure — no DB.

function subject(over: Partial<EnrollmentScopeSubject> & { leadScope?: "all" | "own" | "team" } = {}): EnrollmentScopeSubject {
  const { leadScope = "own", ...rest } = over;
  return {
    userId: "u-1",
    branchId: "b-1",
    branchMemberIds: ["u-1", "u-2"],
    permissions: { leadScope },
    ...rest,
  };
}

describe("canActOnEnrollmentLead", () => {
  it("all-scope (owner/admin) is never blocked", () => {
    expect(canActOnEnrollmentLead(subject({ leadScope: "all" }), { assigned_to: "x" }, [])).toBe(true);
  });

  it("own-scope: allowed when the lead is assigned to the user", () => {
    expect(canActOnEnrollmentLead(subject(), { assigned_to: "u-1" }, [])).toBe(true);
  });

  it("own-scope: allowed via a branch-share row assigned to the user", () => {
    const membership = [{ branch_id: "b-9", assigned_to: "u-1", is_origin: false }];
    expect(canActOnEnrollmentLead(subject(), { assigned_to: "x" }, membership)).toBe(true);
  });

  it("own-scope: blocked when the lead belongs to someone else", () => {
    expect(canActOnEnrollmentLead(subject(), { assigned_to: "someone-else" }, [])).toBe(false);
  });

  it("own-scope: blocked for an unassigned lead", () => {
    expect(canActOnEnrollmentLead(subject(), { assigned_to: null }, [])).toBe(false);
  });

  it("team-scope: allowed when the lead's assignee is in the user's branch", () => {
    expect(canActOnEnrollmentLead(subject({ leadScope: "team" }), { assigned_to: "u-2" }, [])).toBe(true);
  });

  it("team-scope: allowed when the lead sits directly in the user's branch", () => {
    expect(canActOnEnrollmentLead(subject({ leadScope: "team" }), { assigned_to: "x", branch_id: "b-1" }, [])).toBe(true);
  });

  it("team-scope: blocked when the lead is in another branch", () => {
    expect(canActOnEnrollmentLead(subject({ leadScope: "team" }), { assigned_to: "x", branch_id: "b-2" }, [])).toBe(false);
  });
});

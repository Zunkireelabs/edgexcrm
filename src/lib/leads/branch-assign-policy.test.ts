import { describe, it, expect } from "vitest";
import {
  canAssignOnBranchRow,
  isAdminAssignmentTarget,
  isBranchManagerCaller,
  isLeadInManagerBranch,
  isOwnerOrAdminCaller,
  isValidBranchRowAssignee,
  type BranchAssignCaller,
} from "./branch-assign-policy";

const ORIGIN = "branch-origin";
const RECEIVING = "branch-receiving";
const OTHER = "branch-other";
const lead = [{ branch_id: ORIGIN }, { branch_id: RECEIVING }]; // shared from ORIGIN into RECEIVING

const owner: BranchAssignCaller = { role: "owner", permissions: { baseTier: "owner", leadScope: "all" }, branchId: null };
const admin: BranchAssignCaller = { role: "admin", permissions: { baseTier: "admin", leadScope: "all" }, branchId: null };
const receivingManager: BranchAssignCaller = { role: "member", permissions: { baseTier: "member", leadScope: "team" }, branchId: RECEIVING };
const originManager: BranchAssignCaller = { role: "member", permissions: { baseTier: "member", leadScope: "team" }, branchId: ORIGIN };
const otherManager: BranchAssignCaller = { role: "member", permissions: { baseTier: "member", leadScope: "team" }, branchId: OTHER };
const counselor: BranchAssignCaller = { role: "staff", permissions: { baseTier: "member", leadScope: "own" }, branchId: RECEIVING };
const branchlessTeamMember: BranchAssignCaller = { role: "member", permissions: { baseTier: "member", leadScope: "team" }, branchId: null };

describe("canAssignOnBranchRow — who may act on a branch's row", () => {
  it("owner and admin may assign on ANY row, origin or receiving", () => {
    for (const c of [owner, admin]) for (const row of [ORIGIN, RECEIVING, OTHER]) expect(canAssignOnBranchRow(c, row, lead)).toBe(true);
  });

  it("the RECEIVING branch's manager may assign on their own (shared-in) row — the reported case", () => {
    expect(canAssignOnBranchRow(receivingManager, RECEIVING, lead)).toBe(true);
  });

  it("a manager may NOT assign on another branch's row, even one that holds the lead", () => {
    expect(canAssignOnBranchRow(receivingManager, ORIGIN, lead)).toBe(false);
    expect(canAssignOnBranchRow(originManager, RECEIVING, lead)).toBe(false);
  });

  it("a manager whose branch does NOT hold the lead may not assign", () => {
    expect(canAssignOnBranchRow(otherManager, OTHER, lead)).toBe(false);
  });

  it("counselors, viewers and branchless team members may not assign on a branch row", () => {
    expect(canAssignOnBranchRow(counselor, RECEIVING, lead)).toBe(false);
    expect(canAssignOnBranchRow(branchlessTeamMember, RECEIVING, lead)).toBe(false);
  });

  it("legacy `role` alone is enough to count as admin (matches requireAdmin()), so no admin is locked out", () => {
    const roleOnly: BranchAssignCaller = { role: "admin", permissions: { baseTier: "member", leadScope: "own" }, branchId: null };
    expect(isOwnerOrAdminCaller(roleOnly)).toBe(true);
    expect(canAssignOnBranchRow(roleOnly, RECEIVING, lead)).toBe(true);
  });
});

describe("isBranchManagerCaller", () => {
  it("needs team scope AND a branch, and isn't an admin", () => {
    expect(isBranchManagerCaller(receivingManager)).toBe(true);
    expect(isBranchManagerCaller(branchlessTeamMember)).toBe(false);
    expect(isBranchManagerCaller(counselor)).toBe(false);
    expect(isBranchManagerCaller(admin)).toBe(false);
  });
});

describe("isValidBranchRowAssignee — who may be picked", () => {
  it("a member of the row's branch is valid, in any industry", () => {
    expect(isValidBranchRowAssignee({ branchId: RECEIVING, role: "staff" }, RECEIVING, "it_agency")).toBe(true);
  });

  it("a member of a DIFFERENT branch is not", () => {
    expect(isValidBranchRowAssignee({ branchId: OTHER, role: "staff" }, RECEIVING, "education_consultancy")).toBe(false);
  });

  it("an admin is valid for any branch — including a branchless admin — in education_consultancy", () => {
    expect(isValidBranchRowAssignee({ branchId: null, role: "admin" }, RECEIVING, "education_consultancy")).toBe(true);
    expect(isValidBranchRowAssignee({ branchId: OTHER, role: "admin" }, RECEIVING, "education_consultancy")).toBe(true);
  });

  it("the admin exemption is education-only (unchanged from apply-lead-patch.ts) and admin-role-only", () => {
    expect(isAdminAssignmentTarget("it_agency", "admin")).toBe(false);
    expect(isAdminAssignmentTarget("education_consultancy", "staff")).toBe(false);
    expect(isAdminAssignmentTarget("education_consultancy", "owner")).toBe(false);
    expect(isValidBranchRowAssignee({ branchId: null, role: "admin" }, RECEIVING, "it_agency")).toBe(false);
  });

  it("a branchless non-admin is never valid", () => {
    expect(isValidBranchRowAssignee({ branchId: null, role: "staff" }, RECEIVING, "education_consultancy")).toBe(false);
  });
});

describe("isLeadInManagerBranch — bulk scope", () => {
  const members = ["m1", "m2"];
  it("a lead SHARED IN to the manager's branch counts (the bulk-assign gap)", () => {
    expect(isLeadInManagerBranch({ branch_id: ORIGIN, assigned_to: null }, true, RECEIVING, members)).toBe(true);
  });
  it("the lead's own branch counts", () => {
    expect(isLeadInManagerBranch({ branch_id: RECEIVING, assigned_to: null }, false, RECEIVING, members)).toBe(true);
  });
  it("a lead assigned to one of the branch's members counts", () => {
    expect(isLeadInManagerBranch({ branch_id: ORIGIN, assigned_to: "m2" }, false, RECEIVING, members)).toBe(true);
  });
  it("an unrelated lead does not, and a manager with no branch matches nothing", () => {
    expect(isLeadInManagerBranch({ branch_id: ORIGIN, assigned_to: "x" }, false, RECEIVING, members)).toBe(false);
    expect(isLeadInManagerBranch({ branch_id: null, assigned_to: null }, true, null, members)).toBe(false);
  });
});

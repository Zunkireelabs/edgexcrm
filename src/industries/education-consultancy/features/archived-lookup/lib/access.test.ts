import { describe, it, expect } from "vitest";
import { canOpenLead } from "./access";

type Subject = Parameters<typeof canOpenLead>[0];
const subject = (over: { baseTier?: "owner" | "admin" | "member"; leadScope?: "all" | "own" | "team"; branchMemberIds?: string[] } = {}): Subject => ({
  userId: "u-1",
  branchMemberIds: over.branchMemberIds ?? [],
  permissions: { baseTier: over.baseTier ?? "member", leadScope: over.leadScope ?? "own" },
});

describe("canOpenLead (does the preview offer 'Open lead'?)", () => {
  it("owner and admin always", () => {
    expect(canOpenLead(subject({ baseTier: "owner" }), { assigned_to: "x" })).toBe(true);
    expect(canOpenLead(subject({ baseTier: "admin" }), { assigned_to: null })).toBe(true);
  });
  it("all-scope members", () => {
    expect(canOpenLead(subject({ leadScope: "all" }), { assigned_to: "x" })).toBe(true);
  });
  it("an own-scope counselor only for their own lead", () => {
    expect(canOpenLead(subject(), { assigned_to: "u-1" })).toBe(true);
    expect(canOpenLead(subject(), { assigned_to: "someone-else" })).toBe(false);
    expect(canOpenLead(subject(), { assigned_to: null })).toBe(false);
  });
  it("a team manager for a lead assigned to someone in their branch", () => {
    expect(canOpenLead(subject({ leadScope: "team", branchMemberIds: ["u-2"] }), { assigned_to: "u-2" })).toBe(true);
    expect(canOpenLead(subject({ leadScope: "team", branchMemberIds: ["u-2"] }), { assigned_to: "u-9" })).toBe(false);
  });
});

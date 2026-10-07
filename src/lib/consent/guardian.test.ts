import { describe, it, expect } from "vitest";
import { resolveGuardian, guardianNameAfterRelationshipChange, normalizeGuardianRelationship } from "./guardian";

describe("guardianNameAfterRelationshipChange — switching the relationship never leaves a stale pairing", () => {
  const parents = { fatherName: "Ram", motherName: "Sita" };

  it("empty name: Father/Mother pre-fill from that parent, others stay empty", () => {
    expect(guardianNameAfterRelationshipChange("Father", { ...parents })).toBe("Ram");
    expect(guardianNameAfterRelationshipChange("Mother", { ...parents })).toBe("Sita");
    expect(guardianNameAfterRelationshipChange("Uncle", { ...parents })).toBe("");
  });

  it("Father -> Mother replaces the old parent's name (the reported bug)", () => {
    expect(guardianNameAfterRelationshipChange("Mother", { ...parents, guardianName: "Ram" })).toBe("Sita");
    expect(guardianNameAfterRelationshipChange("Father", { ...parents, guardianName: "Sita" })).toBe("Ram");
  });

  it("Father -> Uncle, or to a parent whose name isn't on file, clears the old parent's name", () => {
    expect(guardianNameAfterRelationshipChange("Uncle", { ...parents, guardianName: "Ram" })).toBe("");
    expect(guardianNameAfterRelationshipChange("Mother", { fatherName: "Ram", guardianName: "Ram" })).toBe("");
  });

  it("a name typed by hand is never overwritten", () => {
    expect(guardianNameAfterRelationshipChange("Mother", { ...parents, guardianName: "Hari Sharma" })).toBe("Hari Sharma");
    expect(guardianNameAfterRelationshipChange("Father", { ...parents, guardianName: "  Hari Sharma " })).toBe("Hari Sharma");
  });
});

describe("resolveGuardian", () => {
  it("Father/Mother print that parent's name even if a stale guardian name is stored", () => {
    expect(resolveGuardian({ guardianRelationship: "Mother", guardianName: "Ram", fatherName: "Ram", motherName: "Sita" }).name).toBe("Sita");
  });
  it("falls back to the typed name when the chosen parent isn't on file; others use the typed name", () => {
    expect(resolveGuardian({ guardianRelationship: "Father", guardianName: "Hari" }).name).toBe("Hari");
    expect(resolveGuardian({ guardianRelationship: "Uncle", guardianName: "Hari", fatherName: "Ram" }).name).toBe("Hari");
  });
  it("no relationship chosen -> no name (never guesses between the parents)", () => {
    expect(resolveGuardian({ fatherName: "Ram", motherName: "Sita" }).name).toBe("");
  });
  it("normalizes legacy text", () => {
    expect(normalizeGuardianRelationship(" FATHER ")).toBe("Father");
    expect(normalizeGuardianRelationship("Step-father")).toBe("Step-father");
  });
});

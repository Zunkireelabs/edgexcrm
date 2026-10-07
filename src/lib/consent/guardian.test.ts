import { CONSENT_FIELD_HINTS } from "./field-hints";
import { PLACEHOLDER_REQUIREMENTS } from "./readiness";
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

  it("Father/Mother always take that parent's name when it's on file — even over a leftover typed name", () => {
    // Uncle "Hari" -> Father: the screen locks "Ram" and the form prints "Ram", so "Hari" must not be saved.
    expect(guardianNameAfterRelationshipChange("Father", { ...parents, guardianName: "Hari" })).toBe("Ram");
    expect(guardianNameAfterRelationshipChange("Mother", { ...parents, guardianName: "Hari Sharma" })).toBe("Sita");
  });

  it("anyone else keeps a name typed by hand; a parent whose name isn't on file keeps it too", () => {
    expect(guardianNameAfterRelationshipChange("Uncle", { ...parents, guardianName: "Hari Sharma" })).toBe("Hari Sharma");
    expect(guardianNameAfterRelationshipChange("Father", { motherName: "Sita", guardianName: " Hari Sharma " })).toBe("Hari Sharma");
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
  it("no relationship chosen: the ONLY parent on file is the guardian (computed, not saved)", () => {
    expect(resolveGuardian({ fatherName: "Ram" })).toEqual({ name: "Ram", relationship: "Father", notApplicable: false });
    expect(resolveGuardian({ motherName: "Sita" })).toEqual({ name: "Sita", relationship: "Mother", notApplicable: false });
    expect(resolveGuardian({ fatherName: "Ram", motherName: " " }).name).toBe("Ram");
  });
  it("no relationship chosen and BOTH parents on file -> nothing: never guesses between two people", () => {
    expect(resolveGuardian({ fatherName: "Ram", motherName: "Sita" })).toEqual({ name: "", relationship: "", notApplicable: false });
  });
  it("no relationship, no parents -> nothing", () => {
    expect(resolveGuardian({})).toEqual({ name: "", relationship: "", notApplicable: false });
  });
  it("a typed guardian name still counts when no relationship/parent decides it", () => {
    expect(resolveGuardian({ guardianName: "Hari", fatherName: "Ram", motherName: "Sita" }).name).toBe("Hari");
  });
  it("normalizes legacy text", () => {
    expect(normalizeGuardianRelationship(" FATHER ")).toBe("Father");
    expect(normalizeGuardianRelationship("Step-father")).toBe("Step-father");
  });
});

describe("CONSENT_FIELD_HINTS", () => {
  it("only explains labels readiness can actually report", () => {
    const labels = new Set(Object.values(PLACEHOLDER_REQUIREMENTS).map((r) => r.label));
    for (const label of Object.keys(CONSENT_FIELD_HINTS)) expect(labels).toContain(label);
  });
  it("covers the guardian and counselor items staff don't recognise on sight", () => {
    for (const label of ["Guardian Relationship", "Guardian Name", "Assigned Counselor"]) {
      expect(CONSENT_FIELD_HINTS[label]).toBeTruthy();
    }
  });
});

import { describe, it, expect } from "vitest";
import { PROFILE_SECTIONS, firstGapSection, missingBySection, sectionOfMissingLabel } from "./profile-sections";

describe("Edit profile sections", () => {
  it("lists the twelve sections in the mockup's order", () => {
    expect(PROFILE_SECTIONS.map((s) => s.label)).toEqual([
      "Personal", "Address", "Basic details", "Guardian", "Passport", "Study interest", "Academic", "Tests", "Work experience", "References", "Funding", "Source",
    ]);
  });
  it("maps a missing-for-consent label to its section (case-insensitive) and ignores unknown ones", () => {
    expect(sectionOfMissingLabel("Father's Name")).toBe("basic");
    expect(sectionOfMissingLabel("passport number")).toBe("passport");
    expect(sectionOfMissingLabel("Assignee")).toBeNull();
  });
  it("counts the gaps per section", () => {
    expect(missingBySection(["Date of Birth", "Father's Name", "Passport Number", "Address", "Assignee"])).toEqual({ basic: 2, passport: 1, address: 1 });
  });
  it("opens at the first section WITH a gap, in list order (not the order the server listed them)", () => {
    expect(firstGapSection(["Passport Number", "Father's Name", "Address"])).toBe("address");
    expect(firstGapSection(["Passport Number"])).toBe("passport");
  });
  it("has no first gap when nothing is missing", () => {
    expect(firstGapSection([])).toBeNull();
    expect(firstGapSection(["Assignee"])).toBeNull();
  });
});

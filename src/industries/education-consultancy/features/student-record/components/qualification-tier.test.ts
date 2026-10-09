import { describe, expect, it } from "vitest";
import { qualificationTier } from "./qualifications-section";

describe("qualificationTier", () => {
  it("treats 'Under Graduate' (two words) like 'Undergraduate' — the client's catalog spelling", () => {
    expect(qualificationTier("Under Graduate")).toBe("ug");
    expect(qualificationTier("Undergraduate")).toBe("ug");
    expect(qualificationTier("Under-graduate")).toBe("ug");
    expect(qualificationTier("UNDER GRADUATE")).toBe("ug");
  });

  it("recognises bachelor wordings and the UG code", () => {
    expect(qualificationTier("Bachelor's")).toBe("ug");
    expect(qualificationTier("Bachelors Degree")).toBe("ug");
    expect(qualificationTier("UG")).toBe("ug");
    expect(qualificationTier("ug")).toBe("ug");
  });

  it("recognises postgraduate / master wordings and the PG code, spaced or not", () => {
    expect(qualificationTier("Post Graduate")).toBe("pg");
    expect(qualificationTier("Postgraduate")).toBe("pg");
    expect(qualificationTier("Master's")).toBe("pg");
    expect(qualificationTier("Masters")).toBe("pg");
    expect(qualificationTier("PG")).toBe("pg");
  });

  it("recognises doctorate wordings", () => {
    expect(qualificationTier("PhD")).toBe("phd");
    expect(qualificationTier("Ph.D.")).toBe("phd");
    expect(qualificationTier("Doctorate")).toBe("phd");
  });

  it("recognises degree abbreviations, with or without dots", () => {
    for (const v of ["B.Sc.", "BSc", "B.A", "BBA", "B.Tech", "BCA", "LLB"]) expect(qualificationTier(v), v).toBe("ug");
    for (const v of ["M.Sc.", "MBA", "M.A.", "MCA", "M.Tech", "MPhil", "LLM"]) expect(qualificationTier(v), v).toBe("pg");
    expect(qualificationTier("D.Phil")).toBe("phd");
    expect(qualificationTier("Postdoctoral")).toBe("phd");
  });

  it("never leaves a chosen level empty: unrecognised wording falls back to the base qualifications", () => {
    for (const v of ["Diploma", "Foundation", "Certificate", "Language Course", "Pre-sessional", "Level 4", "Associate Degree", "Something New"]) {
      expect(qualificationTier(v), v).toBe("ug");
    }
  });

  it("does not let short codes or words hit unrelated levels", () => {
    expect(qualificationTier("Management")).toBe("ug"); // contains "ma" but is not the MA code -> base fallback, not PG
    expect(qualificationTier("Media Studies")).toBe("ug");
    expect(qualificationTier("Beginner")).toBe("ug");
  });

  it("only a blank level means 'no degree level' (the one case that shows the notice)", () => {
    expect(qualificationTier("")).toBeNull();
    expect(qualificationTier("   ")).toBeNull();
    expect(qualificationTier("---")).toBeNull();
  });
});

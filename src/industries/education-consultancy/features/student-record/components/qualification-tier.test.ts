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

  it("does not misread other words that merely contain 'ug' or 'pg'", () => {
    expect(qualificationTier("Foundation")).toBeNull();
    expect(qualificationTier("Diploma")).toBeNull();
    expect(qualificationTier("Language Course")).toBeNull(); // contains "ug" but is not the UG code
    expect(qualificationTier("")).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES, INDUSTRIES } from "@/industries/_registry";

// The feature switch behind the archived-lead search + restore (layout flag, both API routes). Education only.

describe("FEATURES.ARCHIVED_LOOKUP access", () => {
  it("is on for education_consultancy", () => {
    expect(getFeatureAccess(INDUSTRIES.EDUCATION_CONSULTANCY, FEATURES.ARCHIVED_LOOKUP)).toBe(true);
  });
  it("is off for every other industry", () => {
    for (const industry of Object.values(INDUSTRIES)) {
      if (industry === INDUSTRIES.EDUCATION_CONSULTANCY) continue;
      expect(getFeatureAccess(industry, FEATURES.ARCHIVED_LOOKUP), industry).toBe(false);
    }
  });
  it("is off for a tenant with no industry", () => {
    expect(getFeatureAccess(null, FEATURES.ARCHIVED_LOOKUP)).toBe(false);
  });
});

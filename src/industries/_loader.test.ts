import { describe, it, expect } from "vitest";
import { getFeatureAccess } from "./_loader";
import { FEATURES, type FeatureId } from "./_registry";

describe("getFeatureAccess", () => {
  it("returns true for an education-scoped feature under education_consultancy", () => {
    expect(getFeatureAccess("education_consultancy", FEATURES.FORM_BUILDER)).toBe(true);
  });

  it("returns false for an education-scoped feature under a different industry", () => {
    expect(getFeatureAccess("it_agency", FEATURES.FORM_BUILDER)).toBe(false);
  });

  it("returns false for an unknown industryId (falls back to the general manifest, which has no features)", () => {
    expect(getFeatureAccess("not_a_real_industry", FEATURES.FORM_BUILDER)).toBe(false);
  });

  it("returns false for an unknown featureId", () => {
    expect(
      getFeatureAccess("education_consultancy", "not-a-real-feature" as FeatureId)
    ).toBe(false);
  });

  it("returns false for a feature registered in one industry's manifest when checked against an industry with no features (general)", () => {
    // Universal features (leads, pipeline, team, settings) are never
    // passed through getFeatureAccess at all -- they have no FeatureId
    // and bypass the gate entirely. The loader's contract only covers
    // industry-scoped/shared features that DO have a FeatureId: an
    // industry that hasn't registered that feature (here, "general",
    // which registers none) is denied, same as any other mismatch.
    expect(getFeatureAccess("general", FEATURES.RESOURCING)).toBe(false);
  });
});

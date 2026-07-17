import { describe, it, expect } from "vitest";
import { getFeatureAccess, getIndustryAiConfig } from "./_loader";
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

describe("getIndustryAiConfig", () => {
  it("returns the populated real_estate AiConfig (promptAddendum + toolIds)", () => {
    const config = getIndustryAiConfig("real_estate");
    expect(config?.promptAddendum).toContain("capital raise");
    expect(config?.toolIds).toEqual([
      "search_offerings",
      "get_offering",
      "capital_raise_summary",
      "get_investor_commitments",
    ]);
  });

  it("returns education_consultancy's config — no promptAddendum yet, but toolIds includes the pre-existing education-gated universal tool", () => {
    // get_form_submissions_summary lives in src/lib/ai/tools/universal/ but
    // its own `industries` field gates it to education_consultancy only —
    // discovered as pre-existing drift while building the packs.ts <->
    // manifest sync test (packs.test.ts); declared here to close it.
    expect(getIndustryAiConfig("education_consultancy")).toEqual({
      toolIds: ["get_form_submissions_summary"],
    });
  });

  it("returns an empty config for an industry with no AI pack (it_agency)", () => {
    expect(getIndustryAiConfig("it_agency")).toEqual({});
  });

  it("falls back to the general manifest's config for an unknown industryId (matches getManifest's fallback)", () => {
    expect(getIndustryAiConfig("not_a_real_industry")).toEqual({});
  });

  it("falls back to the general manifest's config for a null industryId (matches getManifest's fallback)", () => {
    expect(getIndustryAiConfig(null)).toEqual({});
  });
});

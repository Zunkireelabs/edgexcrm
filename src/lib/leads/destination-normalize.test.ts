import { describe, it, expect } from "vitest";
import {
  stripDecoration,
  normalizeDestinations,
  extractDestinationsFromCustomFields,
  normalizeFieldOfStudy,
  normalizeDegreeLevel,
  resolveFieldOfStudy,
  resolveDegreeLevel,
} from "./destination-normalize";

describe("stripDecoration", () => {
  it("strips a real flag emoji (Regional Indicator pair), not just any pictographic char", () => {
    // Regression guard: Extended_Pictographic alone does NOT match flag emoji —
    // they're a pair of Regional Indicator Symbol codepoints, a different Unicode
    // category. This function shipped 2026-07-29 (PR #311) without \p{Regional_Indicator}
    // and silently never stripped a real flag in production.
    expect(stripDecoration("🇺🇸 USA")).toBe("USA");
    expect(stripDecoration("🇬🇧 UK")).toBe("UK");
    expect(stripDecoration("🇦🇺  Australia")).toBe("Australia");
    expect(stripDecoration("🇨🇦Canada")).toBe("Canada");
  });

  it("strips single-codepoint pictographic decoration", () => {
    expect(stripDecoration("🎓 Undergraduate")).toBe("Undergraduate");
  });

  it("leaves plain text untouched", () => {
    expect(stripDecoration("USA")).toBe("USA");
    expect(stripDecoration("New Zealand")).toBe("New Zealand");
  });

  it("returns empty string for decoration-only input", () => {
    expect(stripDecoration("🇺🇸")).toBe("");
  });
});

describe("normalizeDestinations", () => {
  it("strips decoration for explicitly-posted destinations", () => {
    // This is the exact bug from the screenshot: a form posting the real `destinations`
    // key directly previously got ZERO cleanup (cleanup was only reachable via the
    // custom_fields synonym-key fallback).
    expect(normalizeDestinations(["🇺🇸 USA"])).toEqual(["USA"]);
  });

  it("never rewrites to a different spelling — tenants configure their own catalog wording", () => {
    // Regression guard for the incident this rewrite caused: a prior version rewrote
    // "united states"/"united kingdom" to hardcoded abbreviations ("USA"/"UK"), which broke
    // for any tenant whose real Settings catalog uses full names — an already-correct
    // "United Kingdom" got silently rewritten to "UK", matching no checkbox in that
    // tenant's actual options list.
    expect(normalizeDestinations(["united states"])).toEqual(["united states"]);
    expect(normalizeDestinations(["United Kingdom"])).toEqual(["United Kingdom"]);
    expect(normalizeDestinations(["Dubai"])).toEqual(["Dubai"]);
  });

  it("dedupes case/whitespace-insensitively, keeping the first-seen spelling", () => {
    expect(normalizeDestinations(["USA", "usa", "🇺🇸 USA"])).toEqual(["USA"]);
    expect(normalizeDestinations(["usa", "USA"])).toEqual(["usa"]);
  });

  it("keeps values outside the curated taxonomy as-is (never drops real data)", () => {
    expect(normalizeDestinations(["Some Other Country"])).toEqual(["Some Other Country"]);
  });

  it("drops decoration-only / empty entries", () => {
    expect(normalizeDestinations(["🇺🇸", "", "  "])).toEqual([]);
  });
});

describe("extractDestinationsFromCustomFields", () => {
  it("strips decoration via the synonym-key fallback path without rewriting spelling", () => {
    expect(extractDestinationsFromCustomFields({ interested_country: "🇬🇧 United Kingdom" })).toEqual(["United Kingdom"]);
  });

  it("dedupes across multiple synonym keys, case/whitespace-insensitively", () => {
    expect(
      extractDestinationsFromCustomFields({ interested_country: "USA", country: "usa" })
    ).toEqual(["USA"]);
  });

  it("returns empty array for no custom_fields", () => {
    expect(extractDestinationsFromCustomFields(null)).toEqual([]);
    expect(extractDestinationsFromCustomFields(undefined)).toEqual([]);
  });
});

describe("normalizeFieldOfStudy", () => {
  it("strips decoration", () => {
    expect(normalizeFieldOfStudy("🎓 Business & Management")).toBe("Business & Management");
  });

  it("returns null for empty/null input", () => {
    expect(normalizeFieldOfStudy(null)).toBeNull();
    expect(normalizeFieldOfStudy(undefined)).toBeNull();
    expect(normalizeFieldOfStudy("")).toBeNull();
  });
});

describe("normalizeDegreeLevel", () => {
  it("never rewrites to a different spelling — study_levels is a tenant-configurable catalog", () => {
    // Same rewrite-risk class as destinations: degree_level values must match whatever
    // a tenant's own Settings > Study Levels catalog actually says, not a hardcoded alias.
    expect(normalizeDegreeLevel("UG")).toBe("UG");
    expect(normalizeDegreeLevel("bachelor's")).toBe("bachelor's");
  });

  it("strips decoration only", () => {
    expect(normalizeDegreeLevel("🎓 Undergraduate")).toBe("Undergraduate");
  });

  it("passes through an already-clean value unchanged", () => {
    expect(normalizeDegreeLevel("Undergraduate")).toBe("Undergraduate");
  });

  it("returns null for empty/null input", () => {
    expect(normalizeDegreeLevel(null)).toBeNull();
    expect(normalizeDegreeLevel(undefined)).toBeNull();
  });
});

describe("resolveFieldOfStudy", () => {
  it("prefers the explicit value over custom_fields", () => {
    expect(resolveFieldOfStudy("Engineering & Technology", { field_of_study: "Law & Legal Studies" }))
      .toBe("Engineering & Technology");
  });

  it("falls back to the legacy custom_fields key when explicit is absent", () => {
    expect(resolveFieldOfStudy(null, { field_of_study: "🎓 Law & Legal Studies" })).toBe("Law & Legal Studies");
  });

  it("returns null when neither source has a value", () => {
    expect(resolveFieldOfStudy(null, {})).toBeNull();
    expect(resolveFieldOfStudy(null, null)).toBeNull();
  });
});

describe("resolveDegreeLevel", () => {
  it("prefers the explicit value over custom_fields", () => {
    expect(resolveDegreeLevel("Postgraduate", { degree_level: "UG" })).toBe("Postgraduate");
  });

  it("falls back to custom_fields degree_level, then education_level, without rewriting spelling", () => {
    expect(resolveDegreeLevel(null, { degree_level: "UG" })).toBe("UG");
    expect(resolveDegreeLevel(null, { education_level: "Postgraduate" })).toBe("Postgraduate");
  });

  it("prefers degree_level over education_level when both are present", () => {
    expect(resolveDegreeLevel(null, { degree_level: "UG", education_level: "Postgraduate" })).toBe("UG");
  });

  it("returns null when no source has a value", () => {
    expect(resolveDegreeLevel(null, {})).toBeNull();
  });
});

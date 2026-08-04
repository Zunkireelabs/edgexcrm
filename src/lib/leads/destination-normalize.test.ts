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
  it("strips flags and canonicalizes aliases for explicitly-posted destinations", () => {
    // This is the exact bug from the screenshot: a form posting the real `destinations`
    // key directly previously got ZERO cleanup (canonicalize() was only reachable via
    // the custom_fields synonym-key fallback).
    expect(normalizeDestinations(["🇺🇸 USA"])).toEqual(["USA"]);
    expect(normalizeDestinations(["usa"])).toEqual(["USA"]);
    expect(normalizeDestinations(["united states"])).toEqual(["USA"]);
  });

  it("dedupes after canonicalization", () => {
    expect(normalizeDestinations(["USA", "usa", "🇺🇸 USA"])).toEqual(["USA"]);
  });

  it("keeps values outside the curated taxonomy as-is (never drops real data)", () => {
    expect(normalizeDestinations(["Dubai"])).toEqual(["UAE"]);
    expect(normalizeDestinations(["Some Other Country"])).toEqual(["Some Other Country"]);
  });

  it("drops decoration-only / empty entries", () => {
    expect(normalizeDestinations(["🇺🇸", "", "  "])).toEqual([]);
  });
});

describe("extractDestinationsFromCustomFields", () => {
  it("still normalizes via the synonym-key fallback path", () => {
    expect(extractDestinationsFromCustomFields({ interested_country: "🇬🇧 UK" })).toEqual(["UK"]);
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
  it("canonicalizes common aliases to the full taxonomy label", () => {
    expect(normalizeDegreeLevel("UG")).toBe("Undergraduate");
    expect(normalizeDegreeLevel("bachelor's")).toBe("Undergraduate");
    expect(normalizeDegreeLevel("PG")).toBe("Postgraduate");
    expect(normalizeDegreeLevel("master's")).toBe("Postgraduate");
    expect(normalizeDegreeLevel("phd")).toBe("Doctor of Philosophy (PhD)");
  });

  it("strips decoration before canonicalizing", () => {
    expect(normalizeDegreeLevel("🎓 UG")).toBe("Undergraduate");
  });

  it("passes through an already-canonical value unchanged", () => {
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

  it("falls back to custom_fields degree_level, then education_level", () => {
    expect(resolveDegreeLevel(null, { degree_level: "UG" })).toBe("Undergraduate");
    expect(resolveDegreeLevel(null, { education_level: "PG" })).toBe("Postgraduate");
  });

  it("prefers degree_level over education_level when both are present", () => {
    expect(resolveDegreeLevel(null, { degree_level: "UG", education_level: "PG" })).toBe("Undergraduate");
  });

  it("returns null when no source has a value", () => {
    expect(resolveDegreeLevel(null, {})).toBeNull();
  });
});

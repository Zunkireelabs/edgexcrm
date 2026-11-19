import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Guard (no DB): a lead's destination is free text, the pickers show the tenant's catalog spelling, and comparing the two
// with === / .includes() broke a real lead ("uk" vs "UK" — client report, Manish / Admizz, Nov 2026). This fails the
// build if the places that fixed it quietly go back to an exact-case comparison or stop writing the catalog spelling.

const SRC = join(process.cwd(), "src");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

describe("destination case-insensitivity stays wired in", () => {
  it("every path that WRITES a lead's destinations re-spells them against the tenant catalog", () => {
    for (const rel of [
      "lib/leads/apply-lead-patch.ts", // lead edit (Study Interest panel Save)
      "app/(main)/api/v1/leads/route.ts", // lead create
      "app/api/public/submit/[tenantSlug]/[formSlug]/route.ts", // public form submit
    ]) {
      expect(read(rel).includes("canonicalizeDestinationsForTenant("), `${rel} must call canonicalizeDestinationsForTenant()`).toBe(true);
    }
  });

  it("the shared destination picker matches ignoring case", () => {
    const src = read("components/dashboard/destinations-multi-select.tsx");
    expect(src.includes("canonicalizeDestinations(")).toBe(true);
    // the old exact-case dedupe-only call must not come back
    expect(/normalizeDestinations\(selected\)/.test(src)).toBe(false);
  });

  it("the Add Application sheet narrows countries ignoring case and never to an empty list", () => {
    const src = read("industries/education-consultancy/features/application-tracking/components/add-application-to-lead-sheet.tsx");
    expect(src.includes("countryOptionsForLead(")).toBe(true);
    // the old exact-match filter must not come back
    expect(/countryOptions\.filter\(\(c\) => leadDestinations\.includes\(c\)\)/.test(src)).toBe(false);
  });

  it("college suggestions compare countries ignoring case", () => {
    const src = read("industries/education-consultancy/features/application-tracking/hooks/use-application-reference-data.ts");
    expect(src.includes("sameDestination(")).toBe(true);
    expect(/countries\.includes\(a\.country\)/.test(src)).toBe(false);
  });
});

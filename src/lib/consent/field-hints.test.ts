import { describe, expect, it } from "vitest";
import { CONSENT_FIELD_HINTS } from "./field-hints";
import { GUARDIAN_SECTION_TITLE } from "./guardian";

describe("consent field hints", () => {
  it("point staff at the guardian section by its real name", () => {
    for (const label of ["Guardian Relationship", "Guardian Name", "Guardian Phone", "Guardian Email"]) {
      expect(CONSENT_FIELD_HINTS[label], label).toContain(GUARDIAN_SECTION_TITLE);
    }
  });
});

// Regression guard for SMS-FIX-F11 (docs/SMS-FIX-F11-BRIEF.md): the Audience
// filter picker on the SMS blast composer rendered "No results found" for
// every enumerable field because blast-composer.tsx wired AdvancedFilterBar
// with no optionOverrides. buildAudienceOptionOverrides is the pure function
// that now supplies them — assert every field key it produces resolves to a
// non-empty option list given realistic fixture data, and that none of those
// keys have a static `field.options` on the registry (which would make
// use-filter-options.ts skip optionOverrides entirely and mask this bug).

import { describe, it, expect } from "vitest";
import { buildAudienceOptionOverrides } from "./blast-composer";
import { leadFields } from "@/lib/filters/registry/leads";
import type { CompileCtx } from "@/lib/filters/types";

const FIXTURE = {
  forms: [
    { id: "form-1", name: "Study Abroad Interest" },
    { id: "form-2", name: "Consultation Booking" },
  ],
  sourceFacet: [
    { name: "Facebook Ad", count: 4200 },
    { name: "Walk-in", count: 1100 },
  ],
  assigneeFacet: [
    { name: "unassigned", count: 300 },
    { name: "user-1", count: 900 },
  ],
  roster: [
    { user_id: "user-1", name: "Hardik" },
    { user_id: "user-2", name: "Manjila" },
  ],
};

// The exact six fields Sadin reported as broken on prod (SMS-FIX-F11-BRIEF.md).
const REPORTED_BROKEN_FIELDS = ["form", "source", "assignees", "collaborators", "status", "industry"];

describe("buildAudienceOptionOverrides — F-11 fix", () => {
  const overrides = buildAudienceOptionOverrides(FIXTURE);

  it.each(REPORTED_BROKEN_FIELDS)("resolves a non-empty option list for %s", (key) => {
    expect(overrides[key]?.length ?? 0).toBeGreaterThan(0);
  });

  it("also supplies tags (the one other dynamic field on this picker)", () => {
    expect(overrides.tags?.length ?? 0).toBeGreaterThan(0);
  });

  it("drops the 'unassigned' sentinel from the assignees facet (not a real filterable value here)", () => {
    expect(overrides.assignees?.some((o) => o.value === "unassigned")).toBe(false);
  });

  it("resolves assignee facet ids to real names via the roster, not raw user ids", () => {
    const assignee = overrides.assignees?.find((o) => o.value === "user-1");
    expect(assignee?.label).toBe("Hardik");
  });

  it("falls back to the raw id when the roster hasn't resolved yet (never blanks the picker)", () => {
    const withoutRoster = buildAudienceOptionOverrides({ ...FIXTURE, roster: [] });
    expect(withoutRoster.assignees?.find((o) => o.value === "user-1")?.label).toBe("user-1");
  });

  it("none of the reported-broken fields have a static registry `options` array (the actual root cause)", () => {
    const registry = leadFields({ tz: "UTC", now: new Date(0), industryId: "education_consultancy", permissions: {} } satisfies CompileCtx);
    for (const key of REPORTED_BROKEN_FIELDS) {
      expect(registry[key]?.options ?? []).toHaveLength(0);
    }
  });
});

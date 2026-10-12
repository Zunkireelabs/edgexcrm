// @vitest-environment jsdom
//
// Guard (PR #614 review): on the education lead page, "Edit" opens the Student Details pop-up — it is
// the ONLY editor. Consent refuses to go out while a required profile field is empty, so every field
// consent can ask for MUST be editable in this pop-up, or the student's consent is stuck forever
// (owner/admin override only). This once happened with Residence Country (now {{country}} reads Nationality).
//
// The list of fields is derived from the consent rule itself (every placeholder, empty profile), so a
// new consent requirement without an editor here fails this test.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Lead } from "@/types/database";
import { computeConsentReadiness, type ConsentProfile } from "@/lib/consent/readiness";
import { CONSENT_MERGE_FIELDS } from "@/lib/consent/merge";
import { PersonalDetailsDialog } from "./personal-details-dialog";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const emptyProfile = Object.fromEntries(
  [
    "first_name", "email", "phone", "field_of_study", "degree_level", "city", "nationality", "country",
    "passport_number", "full_address", "father_name", "mother_name", "emergency_contact_name",
    "emergency_contact_phone", "date_of_birth", "guardian_phone", "guardian_email", "guardian_relationship",
    "guardian_name", "assigned_to",
  ].map((k) => [k, null]),
) as unknown as ConsentProfile;

/** Every field label consent can ever ask staff to fill in (composite "X or Y" split into both). */
function everyConsentRequiredLabel(): string[] {
  const template = CONSENT_MERGE_FIELDS.map((f) => `{{${f}}}`).join(" ");
  const { groups } = computeConsentReadiness(template, { ...emptyProfile, custom_fields: {} });
  // The "Assignment" section (Assigned Counselor) is set with the lead's assignee control, not in this pop-up.
  const missing = groups.filter((g) => g.section !== "Assignment").flatMap((g) => g.fields);
  // "Father's or Mother's Name" -> "Father's Name", "Mother's Name" (the shared tail goes on each part).
  const expand = (label: string) => {
    const parts = label.split(" or ");
    if (parts.length === 1) return parts;
    const tail = parts[parts.length - 1].split(" ").slice(1).join(" ");
    return parts.map((p, i) => (i === parts.length - 1 ? p : `${p} ${tail}`));
  };
  return [...new Set(missing.flatMap(expand))];
}

const originalFetch = global.fetch;
afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
});

describe("every field consent can require is editable in Student Details (education's only editor)", () => {
  const labels = everyConsentRequiredLabel();

  it("derives a real list (sanity)", () => {
    expect(labels).toEqual(expect.arrayContaining(["First Name", "Field of Study", "Nationality", "Date of Birth"]));
  });

  it.each(labels)("'%s' has an input in the pop-up's edit mode", async (label) => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: {} }) })) as unknown as typeof fetch;
    render(
      <PersonalDetailsDialog
        lead={{ id: "lead-1", custom_fields: {}, destinations: [] } as unknown as Lead}
        open
        onOpenChange={() => {}}
        openInEditMode
      />,
    );
    expect((await screen.findAllByText(label, { exact: true })).length).toBeGreaterThan(0);
  });
});

import { describe, it, expect } from "vitest";
import {
  computeConsentReadiness,
  extractTemplatePlaceholders,
  ALWAYS_REQUIRED_PLACEHOLDERS,
  AUTOMATIC_PLACEHOLDERS,
  PLACEHOLDER_REQUIREMENTS,
  type ConsentProfile,
} from "./readiness";
import { CONSENT_MERGE_FIELDS } from "./merge";

const complete: ConsentProfile = {
  first_name: "Paras",
  email: "p@example.com",
  phone: "+977-9800000000",
  field_of_study: "Business",
  degree_level: "Postgraduate",
  city: null,
  nationality: null,
  country: null,
  custom_fields: {},
  passport_number: null,
  full_address: null,
  father_name: null,
  mother_name: null,
  emergency_contact_name: null,
  emergency_contact_phone: null,
  date_of_birth: null,
  guardian_phone: null,
  guardian_email: null,
  guardian_relationship: null,
};

describe("extractTemplatePlaceholders", () => {
  it("finds distinct placeholders, tolerating spaces and case", () => {
    expect(extractTemplatePlaceholders("Hi {{student_name}} {{ Passport_Number }} {{student_name}}")).toEqual([
      "student_name",
      "passport_number",
    ]);
  });
  it("handles an empty or missing body", () => {
    expect(extractTemplatePlaceholders(null)).toEqual([]);
    expect(extractTemplatePlaceholders("")).toEqual([]);
  });
});

describe("computeConsentReadiness", () => {
  it("is ready with only the core fields when the template needs nothing else", () => {
    expect(computeConsentReadiness("Dear {{student_name}}, {{organization}} {{date}}", complete)).toEqual({ ready: true, missing: [], groups: [] });
  });

  it("always requires name, email, phone and study info", () => {
    const r = computeConsentReadiness("", { ...complete, first_name: " ", email: null, phone: "", field_of_study: null, degree_level: null });
    expect(r.missing).toEqual(["First Name", "Email", "Phone", "Field of Study", "Degree Level"]);
    expect(r.ready).toBe(false);
  });

  it("names the exact study field that is empty", () => {
    expect(computeConsentReadiness("", { ...complete, degree_level: null }).missing).toEqual(["Degree Level"]);
    expect(computeConsentReadiness("", { ...complete, field_of_study: " " }).missing).toEqual(["Field of Study"]);
  });

  it("groups the missing fields by Student Details section, in the pop-up's order", () => {
    const r = computeConsentReadiness(
      "{{passport_number}} {{guardian_phone}} {{date_of_birth}} {{father_name}} {{city}}",
      { ...complete, degree_level: null },
    );
    expect(r.groups).toEqual([
      { section: "Personal Information", fields: ["City"] },
      { section: "Basic Details", fields: ["Date of Birth", "Father's Name"] },
      { section: "Guardian Details", fields: ["Guardian Phone"] },
      { section: "Passport & Citizenship", fields: ["Passport Number"] },
      { section: "Study Interest", fields: ["Degree Level"] },
    ]);
    expect(r.groups.flatMap((g) => g.fields).sort()).toEqual([...r.missing].sort());
  });

  it("requires only the fields the template uses", () => {
    const r = computeConsentReadiness("Passport {{passport_number}}, father {{father_name}}", complete);
    expect(r.missing).toEqual(["Passport Number", "Father's Name"]);
    expect(computeConsentReadiness("Passport {{passport_number}}", { ...complete, passport_number: "N123" }).ready).toBe(true);
  });

  it("treats parent_name as satisfied by either parent", () => {
    expect(computeConsentReadiness("{{parent_name}}", complete).missing).toEqual(["Father's or Mother's Name"]);
    expect(computeConsentReadiness("{{parent_name}}", { ...complete, mother_name: "Sita" }).ready).toBe(true);
  });

  it("lists a field once even if two placeholders map to it", () => {
    expect(computeConsentReadiness("{{full_address}} {{street_address}}", complete).missing).toEqual(["Full Address"]);
  });

  it("accepts city / nationality kept only in custom_fields", () => {
    const p = { ...complete, custom_fields: { city: "Kathmandu", nationality: "Nepali" } };
    expect(computeConsentReadiness("{{city}} {{nationality}}", p).ready).toBe(true);
  });

  it("does not require automatic placeholders", () => {
    expect(computeConsentReadiness("{{organization}} {{date}} {{consent_version}}", complete).ready).toBe(true);
  });

  it("ignores unknown placeholders", () => {
    expect(computeConsentReadiness("{{something_else}}", complete).ready).toBe(true);
  });
});

describe("Residence Country", () => {
  it("is required when the template uses {{country}}, and filed under the lead page's Details box", () => {
    const r = computeConsentReadiness("{{city}}, {{country}}", { ...complete, city: "Kathmandu" });
    expect(r.missing).toEqual(["Residence Country"]);
    expect(r.groups).toEqual([{ section: "Details", fields: ["Residence Country"] }]);
    expect(computeConsentReadiness("{{country}}", { ...complete, country: "Nepal" }).ready).toBe(true);
  });
});

// Guard: a placeholder an admin can put in the template must never be able to go out blank unnoticed.
// Adding a field to CONSENT_MERGE_FIELDS without deciding how readiness treats it fails here.
describe("every consent placeholder is accounted for", () => {
  const always = new Set<string>(ALWAYS_REQUIRED_PLACEHOLDERS);
  const automatic = new Set<string>(AUTOMATIC_PLACEHOLDERS);
  const profile = new Set(Object.keys(PLACEHOLDER_REQUIREMENTS));

  it.each([...CONSENT_MERGE_FIELDS])("{{%s}} is always-required, automatic, or a profile requirement — exactly one", (field) => {
    const homes = [always.has(field), automatic.has(field), profile.has(field)].filter(Boolean).length;
    expect(homes).toBe(1);
  });

  it("no requirement exists for a placeholder the template can't use", () => {
    const known = new Set<string>(CONSENT_MERGE_FIELDS);
    for (const key of [...always, ...automatic, ...profile]) expect(known.has(key)).toBe(true);
  });
});

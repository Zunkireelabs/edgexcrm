import { describe, it, expect } from "vitest";
import {
  computeConsentReadiness,
  extractTemplatePlaceholders,
  ALWAYS_REQUIRED_PLACEHOLDERS,
  AUTOMATIC_PLACEHOLDERS,
  OPTIONAL_PLACEHOLDERS,
  PLACEHOLDER_REQUIREMENTS,
  CONSENT_PROFILE_COLUMNS,
  consentRequirementGroups,
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
  guardian_name: null,
  assigned_to: null,
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

  it("shows ONE guardian: Father/Mother resolve from the parent names, others need a typed Guardian Name", () => {
    // Nothing chosen yet -> both the name and the relationship are asked for, under Guardian Details.
    const r = computeConsentReadiness("{{parent_name}} {{guardian_relationship}}", complete);
    expect(r.missing).toEqual(["Guardian Name", "Guardian Relationship"]);
    expect(r.groups).toEqual([{ section: "Guardian Details", fields: ["Guardian Name", "Guardian Relationship"] }]);
    // Father picked: father's name is used.
    const tpl = "{{parent_name}} {{guardian_relationship}}";
    expect(computeConsentReadiness(tpl, { ...complete, guardian_relationship: "Father", father_name: "Ram" }).ready).toBe(true);
    expect(computeConsentReadiness(tpl, { ...complete, guardian_relationship: "Father", mother_name: "Sita" }).missing).toEqual(["Guardian Name"]);
    // Mother picked, case-insensitive legacy text.
    expect(computeConsentReadiness(tpl, { ...complete, guardian_relationship: "mother", mother_name: "Sita" }).ready).toBe(true);
    // Uncle needs a typed name.
    expect(computeConsentReadiness(tpl, { ...complete, guardian_relationship: "Uncle" }).missing).toEqual(["Guardian Name"]);
    expect(computeConsentReadiness(tpl, { ...complete, guardian_relationship: "Uncle", guardian_name: "Hari" }).ready).toBe(true);
  });

  it("existing leads (no relationship yet) pass when exactly one parent is on file, and are told what to do when both are", () => {
    const tpl = "{{parent_name}} {{guardian_relationship}}";
    expect(computeConsentReadiness(tpl, { ...complete, father_name: "Ram" }).ready).toBe(true);
    expect(computeConsentReadiness(tpl, { ...complete, mother_name: "Sita" }).ready).toBe(true);
    // Both parents, nothing picked: staff must choose — we don't guess.
    expect(computeConsentReadiness(tpl, { ...complete, father_name: "Ram", mother_name: "Sita" }).missing).toEqual([
      "Guardian Name",
      "Guardian Relationship",
    ]);
    // No parents at all: same.
    expect(computeConsentReadiness(tpl, complete).missing).toEqual(["Guardian Name", "Guardian Relationship"]);
  });

  it("'None / Not applicable' needs no guardian name, phone or email", () => {
    const tpl = "{{parent_name}} {{guardian_relationship}} {{guardian_phone}} {{guardian_email}}";
    expect(computeConsentReadiness(tpl, { ...complete, guardian_relationship: "None" }).ready).toBe(true);
  });

  it("requires an assigned counselor only when the template uses it, filed under Assignment", () => {
    expect(computeConsentReadiness("Counselor: {{assign_name}}", complete).missing).toEqual(["Assigned Counselor"]);
    expect(computeConsentReadiness("Counselor: {{counselor_name}}", complete).groups).toEqual([
      { section: "Assignment", fields: ["Assigned Counselor"] },
    ]);
    expect(computeConsentReadiness("Counselor: {{assign_name}}", { ...complete, assigned_to: "user-1" }).ready).toBe(true);
    expect(computeConsentReadiness("No counselor here", complete).ready).toBe(true);
  });

  it("never blocks on Emergency Contact — Student Details no longer asks for it", () => {
    const r = computeConsentReadiness("{{emergency_contact_name}} {{emergency_contact_phone}}", {
      ...complete, emergency_contact_name: null, emergency_contact_phone: null,
    });
    expect(r.ready).toBe(true);
    expect(r.missing).toEqual([]);
    expect(OPTIONAL_PLACEHOLDERS).toEqual(["emergency_contact_name", "emergency_contact_phone"]);
  });

  it("lists a field once even if two placeholders map to it", () => {
    expect(computeConsentReadiness("{{full_address}} {{street_address}}", complete).missing).toEqual(["Address"]);
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

describe("{{country}} (filled from Nationality — the pop-up has one country field)", () => {
  it("is required when the template uses {{country}}, asked for as Nationality under Personal Information", () => {
    const r = computeConsentReadiness("{{city}}, {{country}}", { ...complete, city: "Kathmandu", nationality: null, country: null });
    expect(r.missing).toEqual(["Nationality"]);
    expect(r.groups).toEqual([{ section: "Personal Information", fields: ["Nationality"] }]);
  });

  it("is satisfied by Nationality alone", () => {
    expect(computeConsentReadiness("{{country}}", { ...complete, nationality: "Nepal", country: null }).ready).toBe(true);
  });

  it("is still satisfied by an older lead's Residence Country alone", () => {
    expect(computeConsentReadiness("{{country}}", { ...complete, nationality: null, country: "Nepal" }).ready).toBe(true);
  });
});

// Guard: a placeholder an admin can put in the template must never be able to go out blank unnoticed.
// Adding a field to CONSENT_MERGE_FIELDS without deciding how readiness treats it fails here.
describe("every consent placeholder is accounted for", () => {
  const always = new Set<string>(ALWAYS_REQUIRED_PLACEHOLDERS);
  const automatic = new Set<string>(AUTOMATIC_PLACEHOLDERS);
  const optional = new Set<string>(OPTIONAL_PLACEHOLDERS);
  const profile = new Set(Object.keys(PLACEHOLDER_REQUIREMENTS));

  it.each([...CONSENT_MERGE_FIELDS])("{{%s}} is always-required, automatic, optional, or a profile requirement — exactly one", (field) => {
    const homes = [always.has(field), automatic.has(field), optional.has(field), profile.has(field)].filter(Boolean).length;
    expect(homes).toBe(1);
  });

  it("no requirement exists for a placeholder the template can't use", () => {
    const known = new Set<string>(CONSENT_MERGE_FIELDS);
    for (const key of [...always, ...automatic, ...optional, ...profile]) expect(known.has(key)).toBe(true);
  });
});

describe("CONSENT_PROFILE_COLUMNS", () => {
  it("selects every ConsentProfile field the rules read (assigned_to and guardian_name included)", () => {
    const cols = CONSENT_PROFILE_COLUMNS.split(",").map((c) => c.trim());
    for (const key of Object.keys(complete)) expect(cols).toContain(key);
  });
});

describe("consentRequirementGroups — what staff must fill, from the template alone", () => {
  const ADMIZZ = "{{student_name}} {{date}} {{assign_name}} {{nationality}} {{passport_number}} {{street_address}}, {{city}}, {{country}} {{parent_name}} {{guardian_relationship}}";

  it("lists the always-required fields plus one per placeholder the template uses, in pop-up order", () => {
    expect(consentRequirementGroups(ADMIZZ)).toEqual([
      { section: "Personal Information", fields: ["First Name", "Email", "Phone", "Nationality", "Address", "City"] },
      { section: "Guardian Details", fields: ["Guardian Name", "Guardian Relationship"] },
      { section: "Passport & Citizenship", fields: ["Passport Number"] },
      { section: "Study Interest", fields: ["Field of Study", "Degree Level"] },
      { section: "Assignment", fields: ["Assigned Counselor"] },
    ]);
  });

  it("matches what computeConsentReadiness would ask of an empty profile", () => {
    const fromTemplate = consentRequirementGroups(ADMIZZ).flatMap((g) => g.fields).sort();
    const blocked = computeConsentReadiness(ADMIZZ, {
      ...complete, first_name: null, email: null, phone: null, field_of_study: null, degree_level: null,
    }).missing.sort();
    expect(fromTemplate).toEqual(blocked);
  });

  it("a bare template needs only the basics", () => {
    expect(consentRequirementGroups("Hello")).toEqual([
      { section: "Personal Information", fields: ["First Name", "Email", "Phone"] },
      { section: "Study Interest", fields: ["Field of Study", "Degree Level"] },
    ]);
  });
});

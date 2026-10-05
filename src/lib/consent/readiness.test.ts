import { describe, it, expect } from "vitest";
import { computeConsentReadiness, extractTemplatePlaceholders, type ConsentProfile } from "./readiness";

const complete: ConsentProfile = {
  first_name: "Paras",
  email: "p@example.com",
  phone: "+977-9800000000",
  field_of_study: "Business",
  degree_level: "Postgraduate",
  city: null,
  nationality: null,
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
    expect(computeConsentReadiness("Dear {{student_name}}, {{organization}} {{date}}", complete)).toEqual({ ready: true, missing: [] });
  });

  it("always requires name, email, phone and study info", () => {
    const r = computeConsentReadiness("", { ...complete, first_name: " ", email: null, phone: "", degree_level: null });
    expect(r.missing).toEqual(["Name", "Email", "Phone", "Study Information"]);
    expect(r.ready).toBe(false);
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

  it("does not require country, or automatic placeholders", () => {
    expect(computeConsentReadiness("{{country}} {{organization}} {{date}} {{consent_version}}", complete).ready).toBe(true);
  });

  it("ignores unknown placeholders", () => {
    expect(computeConsentReadiness("{{something_else}}", complete).ready).toBe(true);
  });
});

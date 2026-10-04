import { describe, it, expect } from "vitest";
import {
  buildConsentMergeData,
  fillConsentTemplate,
  prepareConsentBody,
  applySignerDetails,
  validateSignerDetails,
  CONSENT_MERGE_FIELDS,
} from "./merge";

const base = {
  firstName: "Rohit",
  lastName: "Mehta",
  email: "r@example.com",
  phone: "+977-9701110833",
  city: "Kathmandu",
  country: "Nepal",
  organization: "Admizz Education",
  consentVersion: 3,
  date: new Date(2026, 9, 4),
};

describe("buildConsentMergeData — profile fields", () => {
  it("fills the profile tags from the lead", () => {
    const d = buildConsentMergeData({
      ...base,
      nationality: "Nepali",
      passportNumber: " PA1234567 ",
      fullAddress: "Baneshwor-10",
      fatherName: "Ram Mehta",
      motherName: "Sita Mehta",
      emergencyContactName: "Hari",
      emergencyContactPhone: "9800000000",
      dateOfBirth: "2003-02-01",
      guardianPhone: " 9811111111 ",
      guardianEmail: "g@example.com",
      guardianRelationship: "Father",
    });
    expect(d.guardian_phone).toBe("9811111111");
    expect(d.guardian_email).toBe("g@example.com");
    expect(d.guardian_relationship).toBe("Father");
    expect(d.nationality).toBe("Nepali");
    expect(d.passport_number).toBe("PA1234567");
    expect(d.full_address).toBe("Baneshwor-10");
    expect(d.street_address).toBe("Baneshwor-10");
    expect(d.parent_name).toBe("Ram Mehta and Sita Mehta");
    expect(d.emergency_contact_name).toBe("Hari");
    expect(d.emergency_contact_phone).toBe("9800000000");
    expect(d.date_of_birth).toBe("February 1, 2003");
  });

  it("renders empty strings — never null/undefined — when data is missing", () => {
    const d = buildConsentMergeData(base);
    for (const f of CONSENT_MERGE_FIELDS) {
      if (["student_name", "organization", "date", "consent_version", "student_email", "student_phone", "city", "country"].includes(f)) continue;
      expect(d[f]).toBe("");
    }
  });

  it("parent_name with one parent, and with neither", () => {
    expect(buildConsentMergeData({ ...base, fatherName: "Ram" }).parent_name).toBe("Ram");
    expect(buildConsentMergeData({ ...base, motherName: "Sita" }).parent_name).toBe("Sita");
    expect(buildConsentMergeData({ ...base, fatherName: "  ", motherName: null }).parent_name).toBe("");
  });

  it("ignores a malformed date_of_birth", () => {
    expect(buildConsentMergeData({ ...base, dateOfBirth: "not-a-date" }).date_of_birth).toBe("");
  });
});

describe("fillConsentTemplate", () => {
  it("fills the client's tags and leaves unknown ones untouched", () => {
    const d = buildConsentMergeData({ ...base, nationality: "Nepali", passportNumber: "PA1", fullAddress: "Baneshwor" });
    const out = fillConsentTemplate(
      "{{student_name}} | {{nationality}} | {{passport_number}} | {{street_address}} | {{typo_field}}",
      d,
    );
    expect(out).toBe("Rohit Mehta | Nepali | PA1 | Baneshwor | {{typo_field}}");
  });
});

describe("fillConsentTemplate — empty fields leave no stray commas", () => {
  const fill = (tpl: string, over: Parameters<typeof buildConsentMergeData>[0] extends infer T ? Partial<T> : never) =>
    fillConsentTemplate(tpl, buildConsentMergeData({ ...base, ...over }));
  const tpl = "Address: {{street_address}}, {{city}}, {{country}}";

  it("fully filled", () => {
    expect(fill(tpl, { fullAddress: "Baneshwor" })).toBe("Address: Baneshwor, Kathmandu, Nepal");
  });
  it("blank street (the client's screenshot case)", () => {
    expect(fill(tpl, {})).toBe("Address: Kathmandu, Nepal");
  });
  it("blank street and city", () => {
    expect(fill(tpl, { city: null })).toBe("Address: Nepal");
  });
  it("blank last part", () => {
    expect(fill(tpl, { fullAddress: "Baneshwor", country: null })).toBe("Address: Baneshwor, Kathmandu");
  });
  it("everything blank leaves just the label", () => {
    expect(fill(tpl, { city: null, country: null })).toBe("Address:");
  });
  it("leaves lines without an empty field exactly as written, commas included", () => {
    expect(fill("Hello,, {{student_name}}, ok,", {})).toBe("Hello,, Rohit Mehta, ok,");
  });
  it("only tidies the affected line", () => {
    expect(fill("A: {{passport_number}},\nB: x,, y", {})).toBe("A:\nB: x,, y");
  });
});

describe("signer-filled details", () => {
  const tpl = "Passport: {{passport_number}}\nGuardian: {{guardian_phone}} | {{guardian_email}}\nAddress: {{street_address}}, {{country}}";
  const data = (over = {}) => buildConsentMergeData({ ...base, ...over });

  it("keeps blank signer-fillable tags raw and lists them as missing", () => {
    const { body, missingFields } = prepareConsentBody(tpl, data({ guardianEmail: "g@example.com" }));
    expect(missingFields).toEqual(["passport_number", "full_address", "guardian_phone"]);
    expect(body).toBe("Passport: {{passport_number}}\nGuardian: {{guardian_phone}} | g@example.com\nAddress: {{street_address}}, Nepal");
  });

  it("nothing is missing when the profile has the data", () => {
    const { body, missingFields } = prepareConsentBody(
      "Passport: {{passport_number}}",
      data({ passportNumber: "PA1" }),
    );
    expect(missingFields).toEqual([]);
    expect(body).toBe("Passport: PA1");
  });

  it("a tag not in the template is never asked for", () => {
    expect(prepareConsentBody("Hello {{student_name}}", data()).missingFields).toEqual([]);
  });

  it("applySignerDetails fills the typed values (street_address is an alias of full_address)", () => {
    const { body, missingFields } = prepareConsentBody(tpl, data());
    const out = applySignerDetails(body, { passport_number: "PA9", full_address: "Baneshwor", guardian_phone: "98", guardian_email: "g@x.com" }, missingFields);
    expect(out).toContain("Passport: PA9");
    expect(out).toContain("Address: Baneshwor, Nepal");
  });

  it("anything the signer leaves blank is tidied away, with no stray commas", () => {
    const { body, missingFields } = prepareConsentBody(tpl, data());
    const out = applySignerDetails(body, {}, missingFields);
    expect(out).toContain("Address: Nepal");
    expect(out).not.toContain("{{");
  });

  it("blankAs shows a blank line for the live preview", () => {
    const { body, missingFields } = prepareConsentBody("Passport: {{passport_number}}", data());
    expect(applySignerDetails(body, {}, missingFields, "________")).toBe("Passport: ________");
  });

  it("validateSignerDetails accepts only the requested keys, trimmed", () => {
    const { values, errors } = validateSignerDetails(
      { passport_number: " PA9 ", guardian_phone: "98", nationality: "Nepali", evil: "x" },
      ["passport_number", "guardian_phone"],
    );
    expect(values).toEqual({ passport_number: "PA9", guardian_phone: "98" });
    expect(errors).toEqual({});
  });

  it("validateSignerDetails rejects bad email, non-text and over-long values; ignores junk input", () => {
    const keys = ["guardian_email", "passport_number", "full_address"];
    const { errors } = validateSignerDetails(
      { guardian_email: "nope", passport_number: 5, full_address: "a".repeat(201) },
      keys,
    );
    expect(Object.keys(errors).sort()).toEqual(["full_address", "guardian_email", "passport_number"]);
    expect(validateSignerDetails(null, keys)).toEqual({ values: {}, errors: {} });
    expect(validateSignerDetails([1, 2], keys)).toEqual({ values: {}, errors: {} });
  });
});

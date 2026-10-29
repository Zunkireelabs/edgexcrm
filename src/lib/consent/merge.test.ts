import { describe, it, expect } from "vitest";
import {
  buildConsentMergeData,
  fillConsentTemplate,
  prepareConsentBody,
  applySignerDetails,
  validateSignerDetails,
  CONSENT_MERGE_FIELDS,
  findUnknownPlaceholders,
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
    expect(d.parent_name).toBe("Ram Mehta"); // Father chosen -> ONE guardian, never "X and Y"
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

  it("parent_name is ONE guardian: typed name wins, else the chosen parent, never both", () => {
    const both = { ...base, fatherName: "Ram", motherName: "Sita" };
    expect(buildConsentMergeData({ ...both, guardianRelationship: "Father" }).parent_name).toBe("Ram");
    expect(buildConsentMergeData({ ...both, guardianRelationship: "mother" }).parent_name).toBe("Sita");
    // Father/Mother always print that parent's own name — a stale typed name can't be paired with them.
    expect(buildConsentMergeData({ ...both, guardianRelationship: "Mother", guardianName: "Ram" }).parent_name).toBe("Sita");
    expect(buildConsentMergeData({ ...base, guardianRelationship: "Father", guardianName: "Hari" }).parent_name).toBe("Hari"); // parent not on file -> typed name
    expect(buildConsentMergeData({ ...both, guardianRelationship: "Uncle", guardianName: "Hari" }).guardian_name).toBe("Hari");
    // No relationship / a relationship with no typed name -> blank (readiness blocks the send), never both parents.
    expect(buildConsentMergeData(both).parent_name).toBe("");
    expect(buildConsentMergeData({ ...both, guardianRelationship: "Uncle" }).parent_name).toBe("");
    expect(buildConsentMergeData({ ...base, guardianRelationship: "Father", fatherName: "  " }).parent_name).toBe("");
  });

  it("existing lead with one parent and no relationship: prints that parent AND the matching relationship", () => {
    const d = buildConsentMergeData({ ...base, fatherName: "Ram" });
    expect([d.parent_name, d.guardian_relationship]).toEqual(["Ram", "Father"]);
    const both = buildConsentMergeData({ ...base, fatherName: "Ram", motherName: "Sita" });
    expect([both.parent_name, both.guardian_relationship]).toEqual(["", ""]);
  });

  it("'None / Not applicable' prints N/A for the guardian lines", () => {
    const d = buildConsentMergeData({ ...base, guardianRelationship: "None", fatherName: "Ram" });
    expect([d.parent_name, d.guardian_relationship, d.guardian_phone, d.guardian_email]).toEqual(["N/A", "N/A", "N/A", "N/A"]);
  });

  it("counselor_name and assign_name both carry the assigned counselor", () => {
    const d = buildConsentMergeData({ ...base, counselorName: " Anish Balami " });
    expect(d.counselor_name).toBe("Anish Balami");
    expect(d.assign_name).toBe("Anish Balami");
    expect(fillConsentTemplate("Manager/Counselor: {{assign_name}}", d)).toBe("Manager/Counselor: Anish Balami");
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

describe("Admizz consent template — no raw {{tokens}} reach the student", () => {
  const template = `Printed Name: {{student_name}}
Date Issued: {{date}}

For Admizz Education:
Manager/Counselor: {{assign_name}}

1. Student Information
Name: {{student_name}}
Nationality: {{nationality}} | Passport No.: {{passport_number}}
Address: {{street_address}}, {{city}}, {{country}}

2. Parent/Guardian Information
Name: {{parent_name}}
Relationship: {{guardian_relationship}}`;

  const full = {
    ...base,
    nationality: "Nepali",
    passportNumber: "PA1234567",
    fullAddress: "Baneshwor-10",
    fatherName: "Ram Mehta",
    motherName: "Sita Mehta",
    guardianRelationship: "Mother",
    counselorName: "Anish Balami",
  };

  it("fills every blank for a complete profile, with one guardian", () => {
    const { body, missingFields } = prepareConsentBody(template, buildConsentMessage(full));
    expect(body).not.toContain("{{");
    expect(missingFields).toEqual([]);
    expect(body).toContain("Manager/Counselor: Anish Balami");
    expect(body).toContain("Name: Sita Mehta\nRelationship: Mother");
  });

  it("a student with no guardian prints N/A instead of a blank or raw token", () => {
    const { body } = prepareConsentBody(template, buildConsentMessage({ ...full, guardianRelationship: "None" }));
    expect(body).not.toContain("{{");
    expect(body).toContain("Name: N/A\nRelationship: N/A");
  });

  function buildConsentMessage(input: Parameters<typeof buildConsentMergeData>[0]) {
    return buildConsentMergeData(input);
  }
});

describe("findUnknownPlaceholders", () => {
  it("flags tokens that would reach students raw, ignores known ones, de-duplicates", () => {
    expect(findUnknownPlaceholders("{{student_name}} {{assign_name}} {{ Counselor_Nme }} {{counselor_nme}}")).toEqual(["counselor_nme"]);
    expect(findUnknownPlaceholders(null)).toEqual([]);
  });
});

describe("findUnknownPlaceholders — odd tokens", () => {
  it("flags hyphenated, numbered and spaced tokens that fillConsentTemplate would leave raw", () => {
    expect(findUnknownPlaceholders("{{guardian-name}} {{field2}} {{ guardian name }} {{student_name}}")).toEqual([
      "guardian-name",
      "field2",
      "guardian name",
    ]);
  });
});

// A Nepal address is SAVED ending with the country ("…, Bagmati, Nepal") and the country is also its own merge field, so a
// template that prints both showed "Nepal" twice (client, Oct 2026). The address is filled without its trailing country when
// the same document also prints {{country}}; a template that prints only the address keeps the country.
describe("fillConsentTemplate — the country is printed once", () => {
  const SAVED = "Sunar Gaun, Ward 14, Kathmandu Metropolitan City, Kathmandu, Bagmati, Nepal";
  const WITHOUT = "Sunar Gaun, Ward 14, Kathmandu Metropolitan City, Kathmandu, Bagmati";
  const fill = (tpl: string, over: Record<string, unknown> = {}) =>
    fillConsentTemplate(tpl, buildConsentMergeData({ ...base, fullAddress: SAVED, ...over }));
  const count = (text: string, word: string) => text.split(word).length - 1;

  it("street, city, country on one line: Nepal appears once, at the end (the city is already in the address)", () => {
    const out = fill("Address: {{street_address}}, {{city}}, {{country}}");
    expect(out).toBe(`Address: ${WITHOUT}, Nepal`);
    expect(count(out, "Nepal")).toBe(1);
  });

  it("address then country on one line", () => {
    expect(fill("Address: {{street_address}}, {{country}}")).toBe(`Address: ${WITHOUT}, Nepal`);
  });

  it("address and country on SEPARATE lines: the address line has no Nepal, the Country line keeps it", () => {
    const out = fill("Address: {{street_address}}\nCountry: {{country}}");
    expect(out).toBe(`Address: ${WITHOUT}\nCountry: Nepal`);
    expect(count(out, "Nepal")).toBe(1);
  });

  it("works for {{full_address}} as well as {{street_address}}", () => {
    expect(fill("{{full_address}} / {{country}}")).toBe(`${WITHOUT} / Nepal`);
  });

  it("a template that prints ONLY the address keeps the country (nothing is lost)", () => {
    expect(fill("Address: {{street_address}}")).toBe(`Address: ${SAVED}`);
  });

  it("an address saved without the country is untouched", () => {
    expect(fill("Address: {{street_address}}, {{country}}", { fullAddress: "Baneshwor, Kathmandu" })).toBe("Address: Baneshwor, Kathmandu, Nepal");
  });

  it("another country's typed address is untouched", () => {
    expect(fill("{{street_address}}, {{country}}", { fullAddress: "12 Main St, London", country: "United Kingdom" })).toBe("12 Main St, London, United Kingdom");
  });

  it("matches the country regardless of case", () => {
    expect(fill("{{street_address}}, {{country}}", { fullAddress: "Bagmati, NEPAL" })).toBe("Bagmati, Nepal");
  });

  it("a country whose own name contains a comma still prints once", () => {
    expect(fill("Address: {{street_address}}, {{country}}", { fullAddress: "Gangnam, Seoul, Korea, South", country: "Korea, South" })).toBe("Address: Gangnam, Seoul, Korea, South");
  });

  it("with no country on file the address is left exactly as saved", () => {
    expect(fill("Address: {{street_address}}, {{country}}", { country: null })).toBe(`Address: ${SAVED}`);
  });

  it("an address that is only the country leaves no stray comma", () => {
    expect(fill("Address: {{street_address}}, {{city}}, {{country}}", { fullAddress: "Nepal" })).toBe("Address: Kathmandu, Nepal");
  });

  it("the default template (city + country, no address field) is unaffected", () => {
    expect(fill("Address: {{city}}, {{country}}")).toBe("Address: Kathmandu, Nepal");
  });

  it("the live preview / send path (prepareConsentBody) de-duplicates too", () => {
    const data = buildConsentMergeData({ ...base, fullAddress: SAVED });
    const { body, missingFields } = prepareConsentBody("Address: {{street_address}}, {{city}}, {{country}}", data);
    expect(missingFields).toEqual([]);
    expect(count(body, "Nepal")).toBe(1);
    expect(body).toBe(`Address: ${WITHOUT}, Nepal`);
  });

  it("an address the STUDENT fills in later (blank on file) still flows through the signer step unchanged", () => {
    const data = buildConsentMergeData({ ...base, fullAddress: null });
    const { body, missingFields } = prepareConsentBody("Address: {{street_address}}", data);
    expect(missingFields).toContain("full_address");
    expect(applySignerDetails(body, { full_address: "Baneshwor, Kathmandu" }, missingFields)).toBe("Address: Baneshwor, Kathmandu");
  });
});

// A Nepal address already contains its municipality ("…, Birgunj Metropolitan City, …") and City is filled from that same municipality
// ("Birgunj"), so a template that prints {{street_address}}, {{city}}, {{country}} showed the city twice (client, Oct 2026).
describe("fillConsentTemplate — the city is printed once", () => {
  const BIRGUNJ = "Ward 14, Birgunj Metropolitan City, Parsa, Madhesh, Nepal";
  const TPL = "Address: {{street_address}}, {{city}}, {{country}}";
  const fill = (tpl: string, over: Record<string, unknown> = {}) =>
    fillConsentTemplate(tpl, buildConsentMergeData({ ...base, fullAddress: BIRGUNJ, city: "Birgunj", ...over }));
  const count = (text: string, word: string) => text.split(word).length - 1;

  it("the client's Birgunj case: Birgunj and Nepal each appear once, in the address", () => {
    const out = fill(TPL);
    expect(out).toBe("Address: Ward 14, Birgunj Metropolitan City, Parsa, Madhesh, Nepal");
    expect(count(out, "Birgunj")).toBe(1);
    expect(count(out, "Nepal")).toBe(1);
  });

  it("is not case sensitive", () => {
    expect(fill(TPL, { city: "BIRGUNJ" })).toBe("Address: Ward 14, Birgunj Metropolitan City, Parsa, Madhesh, Nepal");
  });

  it("a typed address that repeats the city collapses it", () => {
    expect(fill(TPL, { fullAddress: "Kathmandu, Nepal", city: "Kathmandu" })).toBe("Address: Kathmandu, Nepal");
  });

  it("a city that is NOT in the address still prints", () => {
    expect(fill(TPL, { fullAddress: "12 Main St, Parsa", city: "Birgunj", country: "Nepal" })).toBe("Address: 12 Main St, Parsa, Birgunj, Nepal");
  });

  it("only a whole word counts: Lalit is not found inside Lalitpur", () => {
    expect(fill(TPL, { fullAddress: "Ward 3, Lalitpur Metropolitan City, Lalitpur, Bagmati, Nepal", city: "Lalit" })).toBe(
      "Address: Ward 3, Lalitpur Metropolitan City, Lalitpur, Bagmati, Lalit, Nepal",
    );
  });

  it("a template that prints only the city (no address tag) keeps the city", () => {
    expect(fill("Address: {{city}}, {{country}}")).toBe("Address: Birgunj, Nepal");
  });

  it("with no address on file the city still prints", () => {
    expect(fill(TPL, { fullAddress: null })).toBe("Address: Birgunj, Nepal");
  });

  it("works for {{full_address}} as well as {{street_address}}", () => {
    expect(fill("{{full_address}}, {{city}}, {{country}}")).toBe("Ward 14, Birgunj Metropolitan City, Parsa, Madhesh, Nepal");
  });

  it("the live preview / send path (prepareConsentBody) de-duplicates too", () => {
    const data = buildConsentMergeData({ ...base, fullAddress: BIRGUNJ, city: "Birgunj" });
    const { body } = prepareConsentBody(TPL, data);
    expect(body).toBe("Address: Ward 14, Birgunj Metropolitan City, Parsa, Madhesh, Nepal");
  });

  it("a preview that shows blanks as lines does not turn the de-duplicated city into a blank line", () => {
    const out = fillConsentTemplate(TPL, buildConsentMergeData({ ...base, fullAddress: BIRGUNJ, city: "Birgunj" }), { blankAs: "________" });
    expect(out).not.toContain("________");
    expect(count(out, "Birgunj")).toBe(1);
  });
});

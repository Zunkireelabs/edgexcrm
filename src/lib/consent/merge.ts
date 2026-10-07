/**
 * Dynamic consent template merge fields.
 *
 * The admin writes the consent body once in the CRM with `{{placeholders}}`,
 * and each student gets a personalized document when the link is sent. Only
 * reliably-available data is supported (guardian/program intentionally dropped,
 * since program lives on an application that doesn't exist yet at consent time).
 */

import { resolveGuardian, NOT_APPLICABLE_TEXT } from "./guardian";

export interface ConsentMergeData {
  student_name: string;
  student_email: string;
  student_phone: string;
  city: string;
  country: string;
  organization: string;
  date: string;
  consent_version: string;
  nationality: string;
  passport_number: string;
  full_address: string;
  /** Alias of full_address — the client's template calls it `street_address`. */
  street_address: string;
  father_name: string;
  mother_name: string;
  /** The ONE guardian shown on the form (see guardian.ts) — never father and mother joined. */
  parent_name: string;
  /** Alias of parent_name. */
  guardian_name: string;
  /** Name of the lead's assigned counselor. */
  counselor_name: string;
  /** Alias of counselor_name — the client's template calls it `assign_name`. */
  assign_name: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  date_of_birth: string;
  guardian_phone: string;
  guardian_email: string;
  guardian_relationship: string;
}

/** The placeholders an admin can use in a consent template body. */
export const CONSENT_MERGE_FIELDS = [
  "student_name",
  "student_email",
  "student_phone",
  "city",
  "country",
  "organization",
  "date",
  "consent_version",
  "nationality",
  "passport_number",
  "full_address",
  "street_address",
  "father_name",
  "mother_name",
  "parent_name",
  "guardian_name",
  "counselor_name",
  "assign_name",
  "emergency_contact_name",
  "emergency_contact_phone",
  "date_of_birth",
  "guardian_phone",
  "guardian_email",
  "guardian_relationship",
] as const;

/** `{{tokens}}` in a template body that aren't a known merge field — they would reach students as raw text. */
export function findUnknownPlaceholders(body: string | null | undefined): string[] {
  const known = new Set<string>(CONSENT_MERGE_FIELDS);
  const unknown = new Set<string>();
  // Any {{token}} (hyphens, digits, spaces inside): fillConsentTemplate only fills [a-z_]+ names, so
  // `{{guardian-name}}` or `{{field2}}` would otherwise reach the student raw with no warning.
  for (const m of (body ?? "").matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)) {
    const token = m[1].toLowerCase();
    if (!known.has(token)) unknown.add(token);
  }
  return [...unknown];
}

/** Stands in for an empty known field until the line is tidied (see tidyEmptyFields). */
const EMPTY = "\u0000";

/**
 * Replace `{{field}}` tokens in the template body with student data.
 * Unknown tokens are left untouched so a typo is visible rather than silently
 * blanked. Missing-but-known fields render as an empty string; on a line where
 * one was blank, the stray separators it leaves behind are tidied up so
 * "{{street}}, {{city}}, {{country}}" reads "Kathmandu, Nepal" rather than ", , Nepal".
 */
export function fillConsentTemplate(
  body: string,
  data: Partial<ConsentMergeData>,
  options: {
    /** Tags to keep as raw `{{tag}}` when blank — the signer fills them in later. */
    deferBlank?: ReadonlySet<string>;
    /** Render a blank as this text (e.g. "________") instead of tidying it away. */
    blankAs?: string;
  } = {},
): string {
  const map = data as unknown as Record<string, string | undefined>;
  const filled = body.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (token, rawKey: string) => {
    const key = rawKey.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      const value = map[key];
      if (value) return value;
      if (options.deferBlank?.has(key)) return token; // signer will fill this in
      return options.blankAs ?? EMPTY;
    }
    return token; // unknown placeholder — leave as-is
  });
  return filled
    .split("\n")
    .map((line) => (line.includes(EMPTY) ? tidyEmptyFields(line) : line))
    .join("\n");
}

/** Drop empty-field markers and the commas orphaned by them, on one line only. */
function tidyEmptyFields(line: string): string {
  let out = line.split(EMPTY).join("");
  let prev: string;
  do {
    prev = out;
    out = out
      .replace(/,\s*,/g, ",") // "a, , b" -> "a, b"
      .replace(/(:\s*),\s*/g, "$1") // "Address: , b" -> "Address: b"
      .replace(/\s*,\s*$/, ""); // "a, b," -> "a, b"
  } while (out !== prev);
  return out.replace(/[ \t]+$/, "");
}

/** Build merge data from a lead row + tenant name. */
export function buildConsentMergeData(input: {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  organization: string;
  consentVersion: number | null;
  nationality?: string | null;
  passportNumber?: string | null;
  fullAddress?: string | null;
  fatherName?: string | null;
  motherName?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  /** `leads.date_of_birth` — a DATE column, so an ISO `YYYY-MM-DD` string. */
  dateOfBirth?: string | null;
  guardianPhone?: string | null;
  guardianEmail?: string | null;
  guardianRelationship?: string | null;
  /** `leads.guardian_name` — typed by staff; Father/Mother relationships resolve from the parent names. */
  guardianName?: string | null;
  /** Display name of the lead's assigned counselor (`leads.assigned_to`). */
  counselorName?: string | null;
  date?: Date;
}): ConsentMergeData {
  const date = input.date ?? new Date();
  const formatDate = (d: Date) =>
    d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const father = input.fatherName?.trim() ?? "";
  const mother = input.motherName?.trim() ?? "";
  const address = input.fullAddress?.trim() ?? "";
  const guardian = resolveGuardian({
    guardianName: input.guardianName,
    guardianRelationship: input.guardianRelationship,
    fatherName: father,
    motherName: mother,
  });
  const counselor = input.counselorName?.trim() ?? "";
  // No guardian ("None / Not applicable"): the guardian's own contact lines read N/A rather than asking the signer.
  const na = (value: string | null | undefined) =>
    guardian.notApplicable ? NOT_APPLICABLE_TEXT : (value?.trim() ?? "");
  return {
    student_name: [input.firstName, input.lastName].filter(Boolean).join(" ").trim() || "Student",
    student_email: input.email ?? "",
    student_phone: input.phone ?? "",
    city: input.city ?? "",
    country: input.country ?? "",
    organization: input.organization,
    date: formatDate(date),
    consent_version: input.consentVersion != null ? `v${input.consentVersion}` : "",
    nationality: input.nationality?.trim() ?? "",
    passport_number: input.passportNumber?.trim() ?? "",
    full_address: address,
    street_address: address,
    father_name: father,
    mother_name: mother,
    parent_name: guardian.name,
    guardian_name: guardian.name,
    counselor_name: counselor,
    assign_name: counselor,
    emergency_contact_name: input.emergencyContactName?.trim() ?? "",
    emergency_contact_phone: input.emergencyContactPhone?.trim() ?? "",
    date_of_birth: formatDob(input.dateOfBirth),
    guardian_phone: na(input.guardianPhone),
    guardian_email: na(input.guardianEmail),
    guardian_relationship: guardian.relationship,
  };
}

/** Format a DATE-column value. Parsed as a calendar date (not UTC midnight) so it can't shift a day. */
function formatDob(value: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!m) return "";
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Details a student can type in themselves on the signing page when their profile has none.
 * Keyed by input key; `tags` are the template placeholders that input fills (`street_address`
 * is an alias of `full_address`, so one input fills both). Text only — dates are left to staff.
 */
export const SIGNER_FILLABLE_FIELDS = {
  nationality: { label: "Nationality", tags: ["nationality"] },
  passport_number: { label: "Passport Number", tags: ["passport_number"] },
  full_address: { label: "Address", tags: ["full_address", "street_address"] },
  parent_name: { label: "Parent / Guardian Name", tags: ["parent_name", "guardian_name"] },
  guardian_phone: { label: "Guardian Phone", tags: ["guardian_phone"] },
  guardian_email: { label: "Guardian Email", tags: ["guardian_email"] },
  guardian_relationship: { label: "Guardian Relationship", tags: ["guardian_relationship"] },
  emergency_contact_name: { label: "Emergency Contact Name", tags: ["emergency_contact_name"] },
  emergency_contact_phone: { label: "Emergency Contact Phone", tags: ["emergency_contact_phone"] },
} as const;

export type SignerFillableKey = keyof typeof SIGNER_FILLABLE_FIELDS;

export const SIGNER_FILLABLE_KEYS = Object.keys(SIGNER_FILLABLE_FIELDS) as SignerFillableKey[];

const SIGNER_VALUE_MAX_LENGTH = 200;

function tagsOf(keys: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const k of keys) {
    const f = SIGNER_FILLABLE_FIELDS[k as SignerFillableKey];
    if (f) for (const t of f.tags) out.add(t);
  }
  return out;
}

/**
 * Fill the template for sending. Any signer-fillable tag that is blank on the student's profile
 * stays as a raw `{{tag}}` in the result and its input key is returned in `missingFields`, so the
 * signing page can ask the student for it. Everything else is filled and tidied as usual.
 */
export function prepareConsentBody(
  body: string,
  data: ConsentMergeData,
): { body: string; missingFields: SignerFillableKey[] } {
  const present = new Set(
    Array.from(body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi), (m) => m[1].toLowerCase()),
  );
  const map = data as unknown as Record<string, string | undefined>;
  const missingFields = SIGNER_FILLABLE_KEYS.filter((key) =>
    SIGNER_FILLABLE_FIELDS[key].tags.some((tag) => present.has(tag) && !map[tag]),
  );
  return {
    body: fillConsentTemplate(body, data, { deferBlank: tagsOf(missingFields) }),
    missingFields,
  };
}

/**
 * Substitute what the signer typed into the deferred tags. Anything they left blank is tidied
 * away like any other empty field — or, with `blankAs`, shown as a blank line in a live preview.
 */
export function applySignerDetails(
  body: string,
  details: Partial<Record<SignerFillableKey, string>>,
  missingFields: readonly string[],
  blankAs?: string,
): string {
  const data: Record<string, string> = {};
  for (const key of missingFields) {
    const f = SIGNER_FILLABLE_FIELDS[key as SignerFillableKey];
    if (!f) continue;
    const value = details[key as SignerFillableKey]?.trim() ?? "";
    for (const tag of f.tags) data[tag] = value;
  }
  return fillConsentTemplate(body, data, { blankAs });
}

/**
 * Keep only the details this consent actually asked for (never trust the client's key list),
 * trimmed, text-only and length-limited. Blank values are dropped.
 */
export function validateSignerDetails(
  raw: unknown,
  missingFields: readonly string[],
): { values: Partial<Record<SignerFillableKey, string>>; errors: Record<string, string> } {
  const values: Partial<Record<SignerFillableKey, string>> = {};
  const errors: Record<string, string> = {};
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return { values, errors };
  const input = raw as Record<string, unknown>;
  for (const key of missingFields) {
    if (!(key in SIGNER_FILLABLE_FIELDS)) continue;
    const v = input[key];
    if (v == null || v === "") continue;
    if (typeof v !== "string") {
      errors[key] = "Must be text";
      continue;
    }
    const s = v.trim();
    if (!s) continue;
    if (s.length > SIGNER_VALUE_MAX_LENGTH) {
      errors[key] = `Must be ${SIGNER_VALUE_MAX_LENGTH} characters or fewer`;
      continue;
    }
    if (key === "guardian_email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
      errors[key] = "Must be a valid email address";
      continue;
    }
    values[key as SignerFillableKey] = s;
  }
  return { values, errors };
}

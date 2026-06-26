/**
 * Dynamic consent template merge fields.
 *
 * The admin writes the consent body once in the CRM with `{{placeholders}}`,
 * and each student gets a personalized document when the link is sent. Only
 * reliably-available data is supported (guardian/program intentionally dropped,
 * since program lives on an application that doesn't exist yet at consent time).
 */

export interface ConsentMergeData {
  student_name: string;
  student_email: string;
  student_phone: string;
  city: string;
  country: string;
  organization: string;
  date: string;
  consent_version: string;
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
] as const;

/**
 * Replace `{{field}}` tokens in the template body with student data.
 * Unknown tokens are left untouched so a typo is visible rather than silently
 * blanked. Missing-but-known fields render as an empty string.
 */
export function fillConsentTemplate(body: string, data: ConsentMergeData): string {
  const map = data as unknown as Record<string, string | undefined>;
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (token, rawKey: string) => {
    const key = rawKey.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      return map[key] ?? "";
    }
    return token; // unknown placeholder — leave as-is
  });
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
  date?: Date;
}): ConsentMergeData {
  const date = input.date ?? new Date();
  return {
    student_name: [input.firstName, input.lastName].filter(Boolean).join(" ").trim() || "Student",
    student_email: input.email ?? "",
    student_phone: input.phone ?? "",
    city: input.city ?? "",
    country: input.country ?? "",
    organization: input.organization,
    date: date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    consent_version: input.consentVersion != null ? `v${input.consentVersion}` : "",
  };
}

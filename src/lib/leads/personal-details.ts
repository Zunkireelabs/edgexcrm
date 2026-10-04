// Student "Personal Information" / passport / citizenship columns on `leads`
// (education_consultancy — migration 234). Shared by the PATCH pipeline
// (apply-lead-patch.ts) and the Student Details popup so both agree on the list.

export const PERSONAL_DETAIL_TEXT_COLUMNS = [
  "marital_status",
  "father_name",
  "mother_name",
  "full_address",
  "emergency_contact_name",
  "emergency_contact_phone",
  "passport_number",
  "passport_issued_by",
  "citizenship_number",
  "citizenship_issued_by",
  // Guardian contact (migration 266). Name is derived from father/mother, not stored.
  "guardian_phone",
  "guardian_email",
  "guardian_relationship",
] as const;

export const PERSONAL_DETAIL_DATE_COLUMNS = [
  "date_of_birth",
  "passport_issued_date",
  "passport_expiry_date",
  "citizenship_issued_date",
] as const;

export const PERSONAL_DETAIL_COLUMNS = [
  ...PERSONAL_DETAIL_TEXT_COLUMNS,
  ...PERSONAL_DETAIL_DATE_COLUMNS,
] as const;

export type PersonalDetailColumn = (typeof PERSONAL_DETAIL_COLUMNS)[number];

export const MARITAL_STATUSES = ["unmarried", "married"] as const;

const TEXT_MAX_LENGTH = 500;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealCalendarDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/**
 * Normalises whichever personal-detail columns are present in a request body:
 * text is trimmed ("" → null), dates must be a real `YYYY-MM-DD` ("" → null),
 * marital status must be one of MARITAL_STATUSES. Columns absent from the body
 * are left out, so an untouched field is never overwritten. Invalid values are
 * reported per column rather than sent to Postgres (a bad date would 500).
 */
export function coercePersonalDetailsPayload(body: Record<string, unknown>): {
  values: Record<string, string | null>;
  errors: Record<string, string[]>;
} {
  const values: Record<string, string | null> = {};
  const errors: Record<string, string[]> = {};

  for (const col of PERSONAL_DETAIL_COLUMNS) {
    if (!(col in body) || body[col] === undefined) continue;
    const raw = body[col];
    if (raw !== null && typeof raw !== "string") {
      errors[col] = ["Must be text"];
      continue;
    }
    const s = raw === null ? "" : raw.trim();
    if (s === "") {
      values[col] = null;
      continue;
    }
    if ((PERSONAL_DETAIL_DATE_COLUMNS as readonly string[]).includes(col)) {
      if (!isRealCalendarDate(s)) {
        errors[col] = ["Must be a valid date (YYYY-MM-DD)"];
        continue;
      }
    } else if (col === "guardian_email") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
        errors[col] = ["Must be a valid email address"];
        continue;
      }
    } else if (col === "marital_status") {
      if (!(MARITAL_STATUSES as readonly string[]).includes(s)) {
        errors[col] = [`Must be one of: ${MARITAL_STATUSES.join(", ")}`];
        continue;
      }
    } else if (s.length > TEXT_MAX_LENGTH) {
      errors[col] = [`Must be ${TEXT_MAX_LENGTH} characters or fewer`];
      continue;
    }
    values[col] = s;
  }
  return { values, errors };
}

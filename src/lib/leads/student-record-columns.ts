// Student record columns on `leads` that the Student Details pop-up edits (education_consultancy):
//   • migration 236 — the richer per-qualification fields (address, awarding body, start/end date, stream), and
//   • migration 239 — financial / sponsor details.
//
// ONE list, shared by the PATCH pipeline (apply-lead-patch.ts) and the Student Details pop-up, so the screen and the server can
// never disagree about which fields exist (the way migration 234's list works in personal-details.ts). A field the pop-up
// shows that is NOT in a list like this one simply does not save — that is exactly the bug this file exists to prevent;
// student-record-persistence.test.ts fails the build if an editable field has no destination.

import { TEXT_MAX_LENGTH, isRealCalendarDate } from "./personal-details";

/** Migration 236: 4 levels × address / awarding body / start / end, plus stream/faculty from +2 onward (19 columns). */
export const QUALIFICATION_DETAIL_TEXT_COLUMNS = [
  "see_address",
  "see_awarding_body",
  "plus_two_address",
  "plus_two_awarding_body",
  "plus_two_stream_faculty",
  "bachelor_address",
  "bachelor_awarding_body",
  "bachelor_stream_faculty",
  "masters_address",
  "masters_awarding_body",
  "masters_stream_faculty",
] as const;

export const QUALIFICATION_DETAIL_DATE_COLUMNS = [
  "see_start_date",
  "see_end_date",
  "plus_two_start_date",
  "plus_two_end_date",
  "bachelor_start_date",
  "bachelor_end_date",
  "masters_start_date",
  "masters_end_date",
] as const;

export const QUALIFICATION_DETAIL_COLUMNS = [
  ...QUALIFICATION_DETAIL_TEXT_COLUMNS,
  ...QUALIFICATION_DETAIL_DATE_COLUMNS,
] as const;

/** Migration 239: sponsor / study funding. */
export const FINANCIAL_COLUMNS = [
  "sponsor_name",
  "sponsor_relationship",
  "source_of_funds",
  "scholarship_loan",
] as const;

export const STUDENT_RECORD_COLUMNS = [...QUALIFICATION_DETAIL_COLUMNS, ...FINANCIAL_COLUMNS] as const;
export const STUDENT_RECORD_DATE_COLUMNS = QUALIFICATION_DETAIL_DATE_COLUMNS;

export type StudentRecordColumn = (typeof STUDENT_RECORD_COLUMNS)[number];

/**
 * Normalises whichever student-record columns are present in a request body: text is trimmed ("" → null) and capped, dates
 * must be a real `YYYY-MM-DD` ("" → null). Columns absent from the body are left out, so an untouched field is never
 * overwritten. Invalid values are reported per column instead of reaching Postgres (a bad DATE would surface as a 500).
 */
export function coerceStudentRecordPayload(body: Record<string, unknown>): {
  values: Record<string, string | null>;
  errors: Record<string, string[]>;
} {
  const values: Record<string, string | null> = {};
  const errors: Record<string, string[]> = {};
  const dateColumns: readonly string[] = STUDENT_RECORD_DATE_COLUMNS;

  for (const col of STUDENT_RECORD_COLUMNS) {
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
    if (dateColumns.includes(col)) {
      if (!isRealCalendarDate(s)) {
        errors[col] = ["Must be a valid date (YYYY-MM-DD)"];
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

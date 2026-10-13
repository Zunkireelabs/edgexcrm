// The three "add as many as you need" lists in the Student Details pop-up (education_consultancy):
//   • Work Experience  — table lead_work_experience (migration 237)
//   • References       — table lead_references      (migration 238)
//   • Test scores      — table lead_test_scores     (migration 235; the five legacy overall-score columns on `leads` stay in step)
//
// ONE definition shared by the save route (which validates and writes) and the pop-up (which maps its entries to and from these rows),
// the way student-record-columns.ts does it for the flat columns — so the screen and the server cannot disagree about which fields exist.
// Dependency-free on purpose (no Supabase / React): safe for client bundles and cheap to test.

import { TEXT_MAX_LENGTH, isRealCalendarDate } from "./personal-details";

/** Exam types the pop-up offers. `exam_type` is required on a score row. */
export const EXAM_TYPES = ["IELTS", "TOEFL", "PTE", "Duolingo English Test", "SAT", "GRE/GMAT", "Other Tests"] as const;

/** More than this in one list is not a real student record — and stops a runaway request. */
export const MAX_ROWS_PER_LIST = 25;

export const WORK_EXPERIENCE_COLUMNS = ["institution_name", "address", "position", "start_date", "end_date"] as const;
export const REFERENCE_COLUMNS = ["referee_name", "position", "organization", "email", "address", "relationship"] as const;
export const TEST_SCORE_COLUMNS = ["exam_type", "date_of_exam", "listening", "reading", "writing", "speaking", "overall"] as const;

const DATE_COLUMNS: readonly string[] = ["start_date", "end_date", "date_of_exam"];

export type ListName = "work_experience" | "references" | "test_scores";

export const LIST_COLUMNS: Record<ListName, readonly string[]> = {
  work_experience: WORK_EXPERIENCE_COLUMNS,
  references: REFERENCE_COLUMNS,
  test_scores: TEST_SCORE_COLUMNS,
};

/** The database table behind each list. */
export const LIST_TABLES: Record<ListName, string> = {
  work_experience: "lead_work_experience",
  references: "lead_references",
  test_scores: "lead_test_scores",
};

export type ListRow = { id?: string } & Record<string, string | null>;

export interface CoercedList {
  rows: ListRow[];
  /** Messages keyed like "work_experience[1].start_date" — empty when the list is valid. */
  errors: Record<string, string[]>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validates one list from a request body. Text is trimmed ("" -> null) and capped, dates must be a real YYYY-MM-DD, an email must look
 * like one. A row with nothing filled in (an "Add" that was never typed into) is dropped, not stored. `id` is kept only so the server can
 * tell "update this row" from "new row" — it is never trusted as a database key for an insert.
 */
export function coerceList(list: ListName, input: unknown): CoercedList {
  const errors: Record<string, string[]> = {};
  if (!Array.isArray(input)) return { rows: [], errors: { [list]: ["Must be a list"] } };
  if (input.length > MAX_ROWS_PER_LIST) {
    return { rows: [], errors: { [list]: [`At most ${MAX_ROWS_PER_LIST} entries`] } };
  }
  const columns = LIST_COLUMNS[list];
  const rows: ListRow[] = [];

  input.forEach((raw, index) => {
    const at = (col: string) => `${list}[${index}].${col}`;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      errors[`${list}[${index}]`] = ["Must be an object"];
      return;
    }
    const src = raw as Record<string, unknown>;
    const row: ListRow = {};
    let anyData = false;
    let bad = false;

    for (const col of columns) {
      const value = src[col];
      if (value === undefined || value === null || value === "") {
        row[col] = null;
        continue;
      }
      if (typeof value !== "string") {
        errors[at(col)] = ["Must be text"];
        bad = true;
        continue;
      }
      const s = value.trim();
      if (s === "") {
        row[col] = null;
        continue;
      }
      if (DATE_COLUMNS.includes(col)) {
        if (!isRealCalendarDate(s)) {
          errors[at(col)] = ["Must be a valid date (YYYY-MM-DD)"];
          bad = true;
          continue;
        }
      } else if (col === "email") {
        if (!EMAIL.test(s)) {
          errors[at(col)] = ["Must be a valid email address"];
          bad = true;
          continue;
        }
      } else if (col === "exam_type") {
        if (!(EXAM_TYPES as readonly string[]).includes(s)) {
          errors[at(col)] = [`Must be one of: ${EXAM_TYPES.join(", ")}`];
          bad = true;
          continue;
        }
      }
      if (s.length > TEXT_MAX_LENGTH) {
        errors[at(col)] = [`Must be ${TEXT_MAX_LENGTH} characters or fewer`];
        bad = true;
        continue;
      }
      row[col] = s;
      anyData = true;
    }

    if (bad) return;
    if (!anyData) return; // an empty "Add" row — nothing to store
    if (list === "test_scores" && !row.exam_type) {
      errors[at("exam_type")] = ["Choose the exam type"];
      return;
    }
    if (typeof src.id === "string" && UUID.test(src.id)) row.id = src.id;
    rows.push(row);
  });

  return { rows, errors };
}

/** Which lists a request body asks to change (absent = untouched), validated together. */
export function coerceListsPayload(body: Record<string, unknown>): {
  lists: Partial<Record<ListName, ListRow[]>>;
  errors: Record<string, string[]>;
} {
  const lists: Partial<Record<ListName, ListRow[]>> = {};
  const errors: Record<string, string[]> = {};
  for (const name of Object.keys(LIST_COLUMNS) as ListName[]) {
    if (!(name in body) || body[name] === undefined) continue;
    const result = coerceList(name, body[name]);
    Object.assign(errors, result.errors);
    if (Object.keys(result.errors).length === 0) lists[name] = result.rows;
  }
  return { lists, errors };
}

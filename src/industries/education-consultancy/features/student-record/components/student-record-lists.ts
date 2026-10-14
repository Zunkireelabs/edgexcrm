// Maps the Student Details pop-up's list entries to and from the rows stored by /api/v1/leads/[id]/student-record
// (see lib/leads/student-record-lists.ts for the columns). One tested place, so a field added to a list entry cannot be forgotten on the
// way to the server or on the way back.

import type { Lead } from "@/types/database";
import type { ListRow } from "@/lib/leads/student-record-lists";
import type { WorkExperienceEntry } from "./work-experience-section";
import type { ReferenceEntry } from "./references-section";
import { testScoresFromLead, type TestScore } from "./test-scores-section";

export interface StudentRecordLists {
  workExperience: WorkExperienceEntry[];
  references: ReferenceEntry[];
  testScores: TestScore[];
}

export type StoredRow = Record<string, unknown>;
export interface StoredLists {
  work_experience: StoredRow[];
  references: StoredRow[];
  test_scores: StoredRow[];
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");
/** A DATE column ("2022-01-31", possibly with a time part) as the plain date a date input needs. */
const day = (v: unknown): string => /^\d{4}-\d{2}-\d{2}/.exec(text(v))?.[0] ?? "";

export function workExperienceFromRows(rows: StoredRow[]): WorkExperienceEntry[] {
  return rows.map((r) => ({
    id: text(r.id),
    institutionName: text(r.institution_name),
    address: text(r.address),
    position: text(r.position),
    startDate: day(r.start_date),
    endDate: day(r.end_date),
  }));
}

export function referencesFromRows(rows: StoredRow[]): ReferenceEntry[] {
  return rows.map((r) => ({
    id: text(r.id),
    refereeName: text(r.referee_name),
    position: text(r.position),
    organization: text(r.organization),
    email: text(r.email),
    address: text(r.address),
    relationship: text(r.relationship),
  }));
}

export function testScoresFromRows(rows: StoredRow[]): TestScore[] {
  return rows.map((r) => ({
    id: text(r.id),
    examType: text(r.exam_type),
    dateOfExam: day(r.date_of_exam),
    listening: text(r.listening),
    reading: text(r.reading),
    writing: text(r.writing),
    speaking: text(r.speaking),
    overall: text(r.overall),
  }));
}

/**
 * The scores to show: every stored row, plus — for an older lead whose only record of an exam is one of the five overall-score columns on
 * `leads` — an entry built from that column. A stored row always wins, so a score is never shown twice.
 */
export function mergeTestScores(rows: TestScore[], lead: Lead): TestScore[] {
  const have = new Set(rows.map((r) => r.examType));
  return [...rows, ...testScoresFromLead(lead).filter((legacy) => !have.has(legacy.examType))];
}

export function storedListsToState(stored: StoredLists, lead: Lead): StudentRecordLists {
  return {
    workExperience: workExperienceFromRows(stored.work_experience ?? []),
    references: referencesFromRows(stored.references ?? []),
    testScores: mergeTestScores(testScoresFromRows(stored.test_scores ?? []), lead),
  };
}

// ---- entries -> request rows ----

export function workExperienceToRows(entries: WorkExperienceEntry[]): ListRow[] {
  return entries.map((e) => ({
    id: e.id,
    institution_name: e.institutionName,
    address: e.address,
    position: e.position,
    start_date: e.startDate,
    end_date: e.endDate,
  }));
}

export function referencesToRows(entries: ReferenceEntry[]): ListRow[] {
  return entries.map((e) => ({
    id: e.id,
    referee_name: e.refereeName,
    position: e.position,
    organization: e.organization,
    email: e.email,
    address: e.address,
    relationship: e.relationship,
  }));
}

export function testScoresToRows(entries: TestScore[]): ListRow[] {
  return entries.map((e) => ({
    id: e.id,
    exam_type: e.examType,
    date_of_exam: e.dateOfExam,
    listening: e.listening,
    reading: e.reading,
    writing: e.writing,
    speaking: e.speaking,
    overall: e.overall,
  }));
}

/** The request body for the lists that changed (an unchanged list is left out, so it is never rewritten). */
export function buildListsPayload(
  draft: StudentRecordLists,
  original: StudentRecordLists,
): Partial<Record<"work_experience" | "references" | "test_scores", ListRow[]>> {
  const out: Partial<Record<"work_experience" | "references" | "test_scores", ListRow[]>> = {};
  const changed = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
  if (changed(draft.workExperience, original.workExperience)) out.work_experience = workExperienceToRows(draft.workExperience);
  if (changed(draft.references, original.references)) out.references = referencesToRows(draft.references);
  if (changed(draft.testScores, original.testScores)) out.test_scores = testScoresToRows(draft.testScores);
  return out;
}

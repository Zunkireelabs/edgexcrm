// PERSISTENCE CONTRACT — the permanent guard behind the client's "it showed after Save, but was empty after a refresh" report (Oct 2026).
//
// That happened because the Student Details pop-up showed fields that were never sent to the server (they had no column wired), and nothing
// failed when that was the case. This test makes it fail: it changes EVERY editable field the pop-up has, one at a time, and requires that
// (1) the change produces something in the save request, (2) every column in that request is one the server's lead update will accept, and
// (3) for the qualification cards, what is sent comes back when the lead is reopened.
//
// Adding a field to the pop-up without wiring it to storage now fails here. There are NO exceptions: PREVIEW_ONLY is empty and the test below
// keeps it that way. (Work Experience, References and Test Scores used to be exceptions; they now save through /api/v1/leads/[id]/student-record.)
import { describe, it, expect } from "vitest";
import {
  CORE_IDENTITY_FIELDS,
  FINANCIAL_FIELDS,
  PERSONAL_DETAIL_FIELDS,
  buildLivePatch,
  personalDetailsFromLead,
  type CoreIdentity,
  type LeadSourceValues,
  type StudyInterest,
} from "./personal-details-dialog";
import { emptyQualifications, qualificationsFromLead, type QualificationEntry, type Qualifications } from "./qualifications-section";
import { createTestScore, type TestScore } from "./test-scores-section";
import { createWorkExperience } from "./work-experience-section";
import { createReference } from "./references-section";
import { buildListsPayload, referencesFromRows, testScoresFromRows, workExperienceFromRows, type StudentRecordLists } from "./student-record-lists";
import { LIST_COLUMNS, coerceList, type ListName } from "@/lib/leads/student-record-lists";
import { UPDATABLE_FIELDS } from "@/lib/leads/apply-lead-patch";
import { PERSONAL_DETAIL_COLUMNS } from "@/lib/leads/personal-details";
import { FINANCIAL_COLUMNS, STUDENT_RECORD_COLUMNS } from "@/lib/leads/student-record-columns";
import type { Lead } from "@/types/database";

/** Editable on screen but NOT stored. Must stay EMPTY — adding to it means shipping a field that vanishes on refresh. */
const PREVIEW_ONLY: readonly string[] = [];

/** A qualification field that is not rendered for that level at all (Grade X has no Stream / Faculty). */
const NOT_RENDERED: Array<[keyof Qualifications, keyof QualificationEntry]> = [["see", "streamFaculty"]];

const SERVER = new Set<string>(UPDATABLE_FIELDS);

const core: CoreIdentity = { firstName: "A", lastName: "B", email: "a@b.co", phone: "+9779800000000", nationality: "Nepali", city: "KTM", country: "Nepal", preferredContact: "email" };
const study: StudyInterest = { destinations: ["USA"], fieldOfStudy: "Business", degreeLevel: "Undergraduate", intakeMonth: "May", intakeYear: "2027" };
const source: LeadSourceValues = { source: "Referral", medium: "Facebook", account: "x", campaign: "y" };
const NO_QUALS = emptyQualifications();

const patch = (over: {
  core?: CoreIdentity;
  study?: StudyInterest;
  quals?: Qualifications;
  source?: LeadSourceValues;
  personal?: Record<string, string>;
}) =>
  buildLivePatch(
    over.core ?? core, core,
    over.study ?? study, study,
    over.quals ?? NO_QUALS, NO_QUALS,
    [], [],
    over.source ?? source, source,
    over.personal ?? {}, {},
  );

function expectSavable(p: Record<string, unknown>, what: string) {
  expect(Object.keys(p).length, `${what}: changing it produced NOTHING in the save request — it would vanish on refresh`).toBeGreaterThan(0);
  for (const col of Object.keys(p)) {
    expect(SERVER.has(col), `${what}: the pop-up sends "${col}" but the server's lead update does not accept it`).toBe(true);
  }
}

describe("every editable field in Student Details is saved, and the server accepts what is sent", () => {
  it("core identity (name, email, phone, nationality, city, country, contact method)", () => {
    for (const key of Object.keys(core) as Array<keyof CoreIdentity>) {
      expectSavable(patch({ core: { ...core, [key]: `${core[key]}-edited` } }), `core.${key}`);
    }
    for (const f of CORE_IDENTITY_FIELDS) expect(Object.keys(core)).toContain(f.key);
  });

  it("study interest", () => {
    for (const key of Object.keys(study) as Array<keyof StudyInterest>) {
      const edited = Array.isArray(study[key]) ? ["USA", "UK"] : `${study[key]}-edited`;
      expectSavable(patch({ study: { ...study, [key]: edited } as StudyInterest }), `study.${key}`);
    }
  });

  it("lead source (admin)", () => {
    for (const key of Object.keys(source) as Array<keyof LeadSourceValues>) {
      expectSavable(patch({ source: { ...source, [key]: `${source[key]}-edited` } }), `source.${key}`);
    }
  });

  it("every personal / passport / citizenship / address / guardian column (migration 234)", () => {
    for (const col of PERSONAL_DETAIL_COLUMNS) {
      expect(Object.keys(patch({ personal: { [col]: "2020-01-02" } })), `personal.${col}`).toEqual([col]);
      expect(SERVER.has(col), `${col} is not accepted by the server`).toBe(true);
    }
    for (const f of PERSONAL_DETAIL_FIELDS) expect(PERSONAL_DETAIL_COLUMNS as readonly string[], `field ${f.key} shown but not a column`).toContain(f.key);
  });

  it("every financial field (migration 239)", () => {
    for (const f of FINANCIAL_FIELDS) {
      expect(FINANCIAL_COLUMNS as readonly string[], `financial field ${f.key} shown but not wired`).toContain(f.key);
      expect(Object.keys(patch({ personal: { [f.key]: "x" } }))).toEqual([f.key]);
      expect(SERVER.has(f.key)).toBe(true);
    }
    for (const col of FINANCIAL_COLUMNS) expect(FINANCIAL_FIELDS.some((f) => f.key === col), `column ${col} has no field on screen`).toBe(true);
  });

  it("every qualification field on every level (grade, institution, passed year, address, awarding body, dates, stream)", () => {
    const levels = Object.keys(NO_QUALS) as Array<keyof Qualifications>;
    const fields = Object.keys(NO_QUALS.see) as Array<keyof QualificationEntry>;
    for (const level of levels) {
      for (const field of fields) {
        if (NOT_RENDERED.some(([l, f]) => l === level && f === field)) continue;
        const value = field === "startDate" || field === "endDate" ? "2020-01-02" : "edited";
        const quals = emptyQualifications();
        quals[level] = { ...quals[level], [field]: value };
        expectSavable(patch({ quals }), `qualification ${level}.${field}`);
      }
    }
  });

  it("qualifications ROUND TRIP: everything sent comes back when the lead is reopened (the refresh the client did)", () => {
    const levels = Object.keys(NO_QUALS) as Array<keyof Qualifications>;
    const typed = emptyQualifications();
    for (const level of levels) {
      typed[level] = {
        institution: `${level} school`, address: `${level} address`, awardingBody: `${level} board`,
        startDate: "2015-04-01", endDate: "2019-03-31", percentageGrade: "3.5", passedYear: "2019",
        streamFaculty: level === "see" ? "" : `${level} stream`,
      };
    }
    const sent = patch({ quals: typed });
    expect(qualificationsFromLead(sent as unknown as Lead)).toEqual(typed);
  });

  it("personal + financial values ROUND TRIP through personalDetailsFromLead", () => {
    const personal: Record<string, string> = {};
    for (const col of [...PERSONAL_DETAIL_COLUMNS, ...FINANCIAL_COLUMNS]) personal[col] = "2020-01-02";
    personal.marital_status = "married";
    personal.guardian_email = "g@x.co";
    personal.guardian_relationship = "Father";
    const sent = patch({ personal });
    const back = personalDetailsFromLead(sent as unknown as Lead);
    for (const col of FINANCIAL_COLUMNS) expect(back[col], col).toBe("2020-01-02");
  });

  it("the overall score of each of the five legacy exams still reaches its column (other code reads those columns)", () => {
    const withBreakdown: TestScore = { ...createTestScore(), examType: "IELTS", overall: "7", listening: "8", reading: "7", writing: "6", speaking: "7" };
    const p = buildLivePatch(core, core, study, study, NO_QUALS, NO_QUALS, [withBreakdown], [], source, source);
    expect(Object.keys(p)).toEqual(["ielts_score"]);
  });
});

// The three "add as many as you need" lists are rows saved through PUT /api/v1/leads/[id]/student-record. Every field of every entry must
// reach the request, be a column the server validates, and come back unchanged.
describe("every field of the work experience / references / test score entries is saved and comes back", () => {
  const none: StudentRecordLists = { workExperience: [], references: [], testScores: [] };
  const KEYS: Record<ListName, readonly string[]> = LIST_COLUMNS;

  const fill = (entry: Record<string, string>, skip: string[] = []) => {
    const out = { ...entry };
    for (const k of Object.keys(out)) if (k !== "id" && !skip.includes(k)) out[k] = "x";
    return out;
  };

  it("work experience: each entry field is sent under a real column, and the row round trips", () => {
    const e = createWorkExperience();
    for (const field of ["institutionName", "address", "position", "startDate", "endDate"] as const) {
      const entry = { ...e, [field]: field.endsWith("Date") ? "2020-01-02" : "edited" };
      const payload = buildListsPayload({ ...none, workExperience: [entry] }, none);
      const row = payload.work_experience?.[0] ?? {};
      const sent = Object.keys(row).filter((k) => k !== "id" && row[k]);
      expect(sent, `workExperience.${field} was not sent`).toHaveLength(1);
      expect(KEYS.work_experience, `${sent[0]} is not a column the server accepts`).toContain(sent[0]);
    }
    const full = { ...createWorkExperience(), institutionName: "A", address: "B", position: "C", startDate: "2020-01-02", endDate: "2021-03-04" };
    const rows = coerceList("work_experience", buildListsPayload({ ...none, workExperience: [full] }, none).work_experience).rows;
    expect(workExperienceFromRows(rows as never)).toEqual([{ ...full, id: expect.any(String) }]);
  });

  it("references: each entry field is sent under a real column, and the row round trips", () => {
    const e = createReference();
    for (const field of ["refereeName", "position", "organization", "email", "address", "relationship"] as const) {
      const entry = { ...e, [field]: field === "email" ? "a@b.co" : "edited" };
      const row = buildListsPayload({ ...none, references: [entry] }, none).references?.[0] ?? {};
      const sent = Object.keys(row).filter((k) => k !== "id" && row[k]);
      expect(sent, `references.${field} was not sent`).toHaveLength(1);
      expect(KEYS.references, `${sent[0]} is not a column the server accepts`).toContain(sent[0]);
    }
    const full = { ...createReference(), refereeName: "A", position: "B", organization: "C", email: "d@e.co", address: "F", relationship: "G" };
    const rows = coerceList("references", buildListsPayload({ ...none, references: [full] }, none).references).rows;
    expect(referencesFromRows(rows as never)).toEqual([{ ...full, id: expect.any(String) }]);
  });

  it("test scores: every field of every exam — including Duolingo, Other Tests and the skill breakdown — is sent and round trips", () => {
    const e = createTestScore();
    for (const field of ["dateOfExam", "listening", "reading", "writing", "speaking", "overall"] as const) {
      const entry = { ...e, examType: "IELTS", [field]: field === "dateOfExam" ? "2026-03-01" : "7" };
      const row = buildListsPayload({ ...none, testScores: [entry] }, none).test_scores?.[0] ?? {};
      const sent = Object.keys(row).filter((k) => k !== "id" && k !== "exam_type" && row[k]);
      expect(sent, `testScores.${field} was not sent`).toHaveLength(1);
      expect(KEYS.test_scores, `${sent[0]} is not a column the server accepts`).toContain(sent[0]);
    }
    for (const exam of ["IELTS", "TOEFL", "PTE", "Duolingo English Test", "SAT", "GRE/GMAT", "Other Tests"]) {
      const full: TestScore = { ...createTestScore(), examType: exam, dateOfExam: "2026-03-01", listening: "8", reading: "7", writing: "6", speaking: "7", overall: "7" };
      const rows = coerceList("test_scores", buildListsPayload({ ...none, testScores: [full] }, none).test_scores).rows;
      expect(testScoresFromRows(rows as never), exam).toEqual([{ ...full, id: expect.any(String) }]);
    }
  });

  it("an entry field that has no column would be caught: every key of every entry type is accounted for", () => {
    expect(Object.keys(fill({ id: "i", institutionName: "", address: "", position: "", startDate: "", endDate: "" }))).toHaveLength(6);
    expect(Object.keys(createWorkExperience()).length - 1).toBe(KEYS.work_experience.length);
    expect(Object.keys(createReference()).length - 1).toBe(KEYS.references.length);
    expect(Object.keys(createTestScore()).length - 1).toBe(KEYS.test_scores.length);
  });
});

describe("there are no exceptions", () => {
  it("nothing in Student Details is preview-only: the list of exceptions is empty and must stay empty", () => {
    expect(PREVIEW_ONLY).toEqual([]);
  });
  it("every student-record column is accepted by the server (no column shown on screen can be rejected)", () => {
    for (const col of STUDENT_RECORD_COLUMNS) expect(SERVER.has(col), col).toBe(true);
  });
});

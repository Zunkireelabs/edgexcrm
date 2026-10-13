// PERSISTENCE CONTRACT — the permanent guard behind the client's "it showed after Save, but was empty after a refresh" report (Oct 2026).
//
// That happened because the Student Details pop-up showed fields that were never sent to the server (they had no column wired), and nothing
// failed when that was the case. This test makes it fail: it changes EVERY editable field the pop-up has, one at a time, and requires that
// (1) the change produces something in the save request, (2) every column in that request is one the server's lead update will accept, and
// (3) for the qualification cards, what is sent comes back when the lead is reopened.
//
// Adding a field to the pop-up without wiring it to storage now fails here. The ONLY exceptions are in PREVIEW_ONLY below — each is labelled
// "Not saved yet" on screen, and the list must only ever shrink (PR 2 gives them an API and empties it).
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
import { createTestScore } from "./test-scores-section";
import { UPDATABLE_FIELDS } from "@/lib/leads/apply-lead-patch";
import { PERSONAL_DETAIL_COLUMNS } from "@/lib/leads/personal-details";
import { FINANCIAL_COLUMNS, STUDENT_RECORD_COLUMNS } from "@/lib/leads/student-record-columns";
import type { Lead } from "@/types/database";

/** Editable on screen but NOT stored yet (they have tables but no API). Each shows a "Not saved yet" badge. Shrink this, never grow it. */
const PREVIEW_ONLY = ["work_experience", "references", "test_score_breakdown"] as const;

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

  it("the exam score breakdown is not sent (and is labelled 'Not saved yet')", () => {
    const withBreakdown = { ...createTestScore(), examType: "IELTS", overall: "7", listening: "8", reading: "7", writing: "6", speaking: "7" };
    const p = buildLivePatch(core, core, study, study, NO_QUALS, NO_QUALS, [withBreakdown], [], source, source);
    expect(Object.keys(p)).toEqual(["ielts_score"]); // only the overall score has a column
  });
});

describe("the exceptions are explicit", () => {
  it("PREVIEW_ONLY lists exactly the three sections that are labelled 'Not saved yet'", () => {
    expect([...PREVIEW_ONLY]).toEqual(["work_experience", "references", "test_score_breakdown"]);
  });
  it("every student-record column is accepted by the server (no column shown on screen can be rejected)", () => {
    for (const col of STUDENT_RECORD_COLUMNS) expect(SERVER.has(col), col).toBe(true);
  });
});

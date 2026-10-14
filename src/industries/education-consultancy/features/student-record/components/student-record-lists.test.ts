import { describe, it, expect } from "vitest";
import type { Lead } from "@/types/database";
import { coerceList } from "@/lib/leads/student-record-lists";
import {
  buildListsPayload,
  mergeTestScores,
  referencesFromRows,
  referencesToRows,
  storedListsToState,
  testScoresFromRows,
  testScoresToRows,
  workExperienceFromRows,
  workExperienceToRows,
  type StudentRecordLists,
} from "./student-record-lists";

const ID = "6f1c1c1e-1b2a-4c3d-8e9f-0a1b2c3d4e5f";
const empty: StudentRecordLists = { workExperience: [], references: [], testScores: [] };

describe("rows <-> entries round trip (what is stored comes back exactly)", () => {
  it("work experience", () => {
    const entries = workExperienceFromRows([{ id: ID, institution_name: "Admizz", address: "KTM", position: "Counselor", start_date: "2022-01-31T00:00:00+00:00", end_date: null }]);
    expect(entries).toEqual([{ id: ID, institutionName: "Admizz", address: "KTM", position: "Counselor", startDate: "2022-01-31", endDate: "" }]);
    const rows = coerceList("work_experience", workExperienceToRows(entries)).rows;
    expect(rows[0]).toMatchObject({ id: ID, institution_name: "Admizz", address: "KTM", position: "Counselor", start_date: "2022-01-31", end_date: null });
  });

  it("references", () => {
    const entries = referencesFromRows([{ id: ID, referee_name: "Dr Rai", position: "Head", organization: "TU", email: "r@tu.edu", address: "KTM", relationship: "Teacher" }]);
    const rows = coerceList("references", referencesToRows(entries)).rows;
    expect(referencesFromRows(rows as never)).toEqual(entries);
  });

  it("test scores, including the skill breakdown and the date", () => {
    const entries = testScoresFromRows([{ id: ID, exam_type: "IELTS", date_of_exam: "2026-03-01", listening: "8", reading: "7.5", writing: "6.5", speaking: "7", overall: "7.5" }]);
    expect(entries[0]).toMatchObject({ examType: "IELTS", dateOfExam: "2026-03-01", listening: "8", overall: "7.5" });
    const rows = coerceList("test_scores", testScoresToRows(entries)).rows;
    expect(testScoresFromRows(rows as never)).toEqual(entries);
  });

  it("tolerates missing / null columns", () => {
    expect(workExperienceFromRows([{ id: ID }])).toEqual([{ id: ID, institutionName: "", address: "", position: "", startDate: "", endDate: "" }]);
    expect(testScoresFromRows([{ id: ID, exam_type: "Other Tests" }])[0].overall).toBe("");
  });
});

describe("mergeTestScores — older leads keep their score", () => {
  const lead = { ielts_score: "6.5", pte_score: "70", sat_score: null } as unknown as Lead;
  it("adds an entry from a legacy overall-score column when there is no stored row for that exam", () => {
    const merged = mergeTestScores([], lead);
    expect(merged.map((m) => [m.examType, m.overall])).toEqual([["IELTS", "6.5"], ["PTE", "70"]]);
  });
  it("a stored row wins, so an exam is never shown twice", () => {
    const stored = testScoresFromRows([{ id: ID, exam_type: "IELTS", overall: "7" }]);
    const merged = mergeTestScores(stored, lead);
    expect(merged.filter((m) => m.examType === "IELTS")).toHaveLength(1);
    expect(merged.find((m) => m.examType === "IELTS")?.overall).toBe("7");
    expect(merged.some((m) => m.examType === "PTE")).toBe(true);
  });
});

describe("storedListsToState", () => {
  it("builds all three lists from the server response", () => {
    const state = storedListsToState(
      { work_experience: [{ id: ID, institution_name: "A" }], references: [{ id: ID, referee_name: "B" }], test_scores: [{ id: ID, exam_type: "SAT", overall: "1400" }] },
      {} as Lead,
    );
    expect(state.workExperience[0].institutionName).toBe("A");
    expect(state.references[0].refereeName).toBe("B");
    expect(state.testScores[0]).toMatchObject({ examType: "SAT", overall: "1400" });
  });
  it("copes with an empty or partial response", () => {
    expect(storedListsToState({} as never, {} as Lead)).toEqual(empty);
  });
});

describe("buildListsPayload — only the lists that changed are sent", () => {
  const base: StudentRecordLists = {
    workExperience: workExperienceFromRows([{ id: ID, institution_name: "A" }]),
    references: referencesFromRows([{ id: ID, referee_name: "B" }]),
    testScores: [],
  };
  it("sends nothing when nothing changed", () => {
    expect(buildListsPayload(base, base)).toEqual({});
  });
  it("sends just the changed list", () => {
    const changed = { ...base, references: referencesFromRows([{ id: ID, referee_name: "B2" }]) };
    const payload = buildListsPayload(changed, base);
    expect(Object.keys(payload)).toEqual(["references"]);
    expect(payload.references?.[0]).toMatchObject({ id: ID, referee_name: "B2" });
  });
  it("an emptied list is sent as [] (that is how a delete reaches the server)", () => {
    expect(buildListsPayload({ ...base, workExperience: [] }, base)).toEqual({ work_experience: [] });
  });
  it("a newly added entry is sent with its client id (the server makes the real one)", () => {
    const draft = { ...base, testScores: testScoresFromRows([{ id: "new-1", exam_type: "PTE", overall: "70" }]) };
    expect(buildListsPayload(draft, base).test_scores?.[0]).toMatchObject({ id: "new-1", exam_type: "PTE", overall: "70" });
  });
});

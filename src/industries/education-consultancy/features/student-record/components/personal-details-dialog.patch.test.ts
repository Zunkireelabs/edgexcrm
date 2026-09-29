import { describe, expect, it } from "vitest";
import { buildLivePatch, type CoreIdentity, type LeadSourceValues, type StudyInterest } from "./personal-details-dialog";
import { emptyQualifications, type Qualifications } from "./qualifications-section";
import { createTestScore, type TestScore } from "./test-scores-section";

const core: CoreIdentity = { firstName: "Hardik", lastName: "Phuel", email: "h@example.com", phone: "+9779999999999", nationality: "Nepali", city: "Kathmandu" };
const study: StudyInterest = { destinations: ["USA"], fieldOfStudy: "Business", degreeLevel: "Undergraduate", intakeMonth: "May", intakeYear: "2027" };
const source: LeadSourceValues = { source: "Referral", medium: "Facebook", account: "", campaign: "" };

const score = (examType: string, overall: string): TestScore => ({ ...createTestScore(), examType, overall });

function patchOf(over: {
  core?: CoreIdentity;
  study?: StudyInterest;
  quals?: Qualifications;
  scores?: TestScore[];
  source?: LeadSourceValues | null;
} = {}, original: { scores?: TestScore[] } = {}) {
  return buildLivePatch(
    over.core ?? core, core,
    over.study ?? study, study,
    over.quals ?? emptyQualifications(), emptyQualifications(),
    over.scores ?? [], original.scores ?? [],
    over.source === undefined ? source : over.source, source
  );
}

describe("buildLivePatch", () => {
  it("sends nothing when nothing changed", () => {
    expect(patchOf()).toEqual({});
  });

  it("sends only the fields that changed", () => {
    expect(patchOf({ core: { ...core, city: "Lalitpur" } })).toEqual({ city: "Lalitpur" });
  });

  it("saves the lead source for admins, but only the fields that changed", () => {
    expect(patchOf({ source: { ...source, campaign: "spring-2027" } })).toEqual({ intake_campaign: "spring-2027" });
  });

  it("never sends lead source for non-admins, even if the draft differs (the server would reject the whole save)", () => {
    expect(patchOf({ source: null })).toEqual({});
  });

  it("saves the exam scores that have a column", () => {
    expect(patchOf({ scores: [score("IELTS", "7.5"), score("GRE/GMAT", "320")] })).toEqual({
      ielts_score: "7.5",
      gre_gmat_score: "320",
    });
  });

  it("clears a saved score when its entry is removed", () => {
    expect(patchOf({ scores: [] }, { scores: [score("PTE", "68")] })).toEqual({ pte_score: null });
  });

  it("ignores exams that have no column (they are preview-only)", () => {
    expect(patchOf({ scores: [score("Duolingo English Test", "120")] })).toEqual({});
  });

  it("saves a level's passed year, and clears it when emptied", () => {
    const withYear = emptyQualifications();
    withYear.bachelor.passedYear = " 2021 ";
    expect(patchOf({ quals: withYear })).toEqual({ bachelor_passed_year: "2021" });

    const cleared = emptyQualifications();
    expect(
      buildLivePatch(core, core, study, study, cleared, { ...emptyQualifications(), bachelor: { ...cleared.bachelor, passedYear: "2021" } }, [], [], source, source)
    ).toEqual({ bachelor_passed_year: null });
  });
});

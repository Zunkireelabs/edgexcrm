import { describe, expect, it } from "vitest";
import { buildLivePatch, personalDetailsFromLead, type CoreIdentity, type LeadSourceValues, type StudyInterest } from "./personal-details-dialog";
import { emptyQualifications, qualificationsFromLead, type Qualifications } from "./qualifications-section";
import { createTestScore, type TestScore } from "./test-scores-section";
import type { Lead } from "@/types/database";

const core: CoreIdentity = { firstName: "Hardik", lastName: "Phuel", email: "h@example.com", phone: "+9779999999999", nationality: "Nepali", city: "Kathmandu", country: "", preferredContact: "" };
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

  it("saves Residence Country and Preferred Contact to their real columns (education's only editor for them)", () => {
    expect(patchOf({ core: { ...core, country: "Nepal", preferredContact: "whatsapp" } })).toEqual({
      country: "Nepal",
      preferred_contact_method: "whatsapp",
    });
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

describe("buildLivePatch — personal / passport details (migration 234)", () => {
  const build = (personal: Record<string, string>, original: Record<string, string> = {}) =>
    buildLivePatch(core, core, study, study, emptyQualifications(), emptyQualifications(), [], [], source, source, personal, original);

  it("sends only the personal fields that changed", () => {
    expect(build({ passport_number: "PA123", father_name: "Ram" }, { father_name: "Ram" })).toEqual({ passport_number: "PA123" });
  });

  it("sends nothing when untouched", () => {
    expect(build({ passport_number: "PA123" }, { passport_number: "PA123" })).toEqual({});
  });

  it("trims, and sends null when a value is cleared", () => {
    expect(build({ full_address: "  Baneshwor " })).toEqual({ full_address: "Baneshwor" });
    expect(build({ passport_number: "" }, { passport_number: "PA123" })).toEqual({ passport_number: null });
  });

  it("sends guardian contact fields when changed", () => {
    expect(build({ guardian_phone: " 9800000000 ", guardian_relationship: "Uncle" })).toEqual({
      guardian_phone: "9800000000",
      guardian_relationship: "Uncle",
    });
  });

  it("never sends a key that is not a real column", () => {
    expect(build({ not_a_column: "x", role: "owner" })).toEqual({});
  });

  it("sends the financial / sponsor fields — they are real columns now (migration 239)", () => {
    expect(build({ sponsor_name: "Uncle", source_of_funds: "Bank loan" })).toEqual({ sponsor_name: "Uncle", source_of_funds: "Bank loan" });
  });
});

describe("personalDetailsFromLead", () => {
  const lead = (over: Record<string, unknown>) => over as unknown as Lead;

  it("passes ISO dates and text through; null / missing become empty", () => {
    const v = personalDetailsFromLead(lead({ date_of_birth: "2003-02-01", passport_number: "PA1", father_name: null }));
    expect(v.date_of_birth).toBe("2003-02-01");
    expect(v.passport_number).toBe("PA1");
    expect(v.father_name).toBe("");
    expect(v.mother_name).toBe("");
  });

  it("keeps only the calendar date when a date arrives as a timestamp", () => {
    expect(personalDetailsFromLead(lead({ passport_expiry_date: "2031-05-09T00:00:00+00:00" })).passport_expiry_date).toBe("2031-05-09");
  });

  it("shows an unparseable date as empty rather than garbage", () => {
    expect(personalDetailsFromLead(lead({ date_of_birth: "01/02/2003" })).date_of_birth).toBe("");
  });

  it("does not change text columns that merely look like dates", () => {
    expect(personalDetailsFromLead(lead({ passport_number: "2003-02-01T09" })).passport_number).toBe("2003-02-01T09");
  });

  it("an untouched seeded date produces no patch", () => {
    const seeded = personalDetailsFromLead(lead({ date_of_birth: "2003-02-01T00:00:00+00:00" }));
    expect(
      buildLivePatch(core, core, study, study, emptyQualifications(), emptyQualifications(), [], [], source, source, seeded, seeded)
    ).toEqual({});
  });
});

// The fields the client lost (WhatsApp, Oct 13): a qualification's Address of Institution, Awarding Body and Start / End Date (and
// Stream) showed after Save but were empty after a refresh, because the dialog never sent them. They are real columns
// (migration 236) — every one must be sent when changed, and must come back when the lead is reopened.
describe("buildLivePatch — qualification details (migration 236)", () => {
  const withEntry = (level: keyof Qualifications, over: Partial<Qualifications["see"]>): Qualifications => {
    const q = emptyQualifications();
    q[level] = { ...q[level], ...over };
    return q;
  };

  it("sends Address, Awarding Body, Start Date and End Date for Grade X (SEE)", () => {
    const quals = withEntry("see", { address: "Kathmandu", awardingBody: "NEB", startDate: "2014-04-01", endDate: "2019-03-31" });
    expect(patchOf({ quals })).toEqual({
      see_address: "Kathmandu",
      see_awarding_body: "NEB",
      see_start_date: "2014-04-01",
      see_end_date: "2019-03-31",
    });
  });

  it("uses each level's own column prefix (plus_two, bachelor, masters)", () => {
    expect(patchOf({ quals: withEntry("plusTwo", { address: "Pokhara", startDate: "2019-06-01" }) })).toEqual({ plus_two_address: "Pokhara", plus_two_start_date: "2019-06-01" });
    expect(patchOf({ quals: withEntry("bachelor", { awardingBody: "TU", endDate: "2023-07-01" }) })).toEqual({ bachelor_awarding_body: "TU", bachelor_end_date: "2023-07-01" });
    expect(patchOf({ quals: withEntry("masters", { address: "Lalitpur" }) })).toEqual({ masters_address: "Lalitpur" });
  });

  it("sends Stream / Faculty from +2 onward, and never invents a column for Grade X", () => {
    expect(patchOf({ quals: withEntry("plusTwo", { streamFaculty: "Science" }) })).toEqual({ plus_two_stream_faculty: "Science" });
    expect(patchOf({ quals: withEntry("bachelor", { streamFaculty: "BBA" }) })).toEqual({ bachelor_stream_faculty: "BBA" });
    expect(patchOf({ quals: withEntry("see", { streamFaculty: "Anything" }) })).toEqual({});
  });

  it("clears a saved value (null) when the field is emptied, and trims text", () => {
    const original = withEntry("see", { address: "Old address", startDate: "2014-04-01" });
    const patch = buildLivePatch(core, core, study, study, withEntry("see", { address: "  New address  ", startDate: "" }), original, [], [], source, source);
    expect(patch).toEqual({ see_address: "New address", see_start_date: null });
  });

  it("sends nothing for an untouched qualification", () => {
    const q = withEntry("see", { address: "Same", startDate: "2014-04-01" });
    expect(buildLivePatch(core, core, study, study, q, q, [], [], source, source)).toEqual({});
  });

  it("ROUND TRIP: what the dialog sends comes back when the lead is reopened (the refresh the client did)", () => {
    const typed = withEntry("plusTwo", {
      institution: "National Academy", address: "Baneshwor", awardingBody: "NEB", startDate: "2019-06-01", endDate: "2021-05-30",
      percentageGrade: "3.4", passedYear: "2021", streamFaculty: "Science",
    });
    const patch = patchOf({ quals: typed });
    const reopened = qualificationsFromLead(patch as unknown as Lead);
    expect(reopened.plusTwo).toEqual(typed.plusTwo);
  });

  it("shows nothing for a lead that has none of these saved yet, and strips a timestamp from a date", () => {
    expect(qualificationsFromLead({} as unknown as Lead)).toEqual(emptyQualifications());
    expect(qualificationsFromLead({ see_start_date: "2014-04-01T00:00:00+00:00" } as unknown as Lead).see.startDate).toBe("2014-04-01");
  });
});

describe("personalDetailsFromLead — financial details", () => {
  it("loads the saved sponsor details back", () => {
    const v = personalDetailsFromLead({ sponsor_name: "Uncle", source_of_funds: "Bank loan", scholarship_loan: null } as unknown as Lead);
    expect(v).toMatchObject({ sponsor_name: "Uncle", source_of_funds: "Bank loan", scholarship_loan: "" });
  });
});

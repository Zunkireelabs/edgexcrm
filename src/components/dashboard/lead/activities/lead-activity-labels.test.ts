import { describe, expect, it } from "vitest";
import { describeSubmission, humanizeIntakeValue } from "./lead-activity-labels";

describe("humanizeIntakeValue", () => {
  it("uses the taxonomy label for known sources", () => {
    expect(humanizeIntakeValue("manual_entry")).toBe("Manual Entry");
    expect(humanizeIntakeValue("walk_in")).toBe("Walk-in");
  });

  it("title-cases unknown slugs", () => {
    expect(humanizeIntakeValue("dashboard")).toBe("Dashboard");
    expect(humanizeIntakeValue("check_in")).toBe("Check in");
  });

  it("returns empty for missing values", () => {
    expect(humanizeIntakeValue(null)).toBe("");
    expect(humanizeIntakeValue(undefined)).toBe("");
    expect(humanizeIntakeValue("")).toBe("");
  });
});

describe("describeSubmission", () => {
  it("words a first manual add as created manually", () => {
    expect(describeSubmission({ is_first: { new: true }, created_via: { new: "manual" } })).toBe("Lead created manually");
  });

  it("words a repeat manual add (email already exists) without saying a form was filled", () => {
    expect(describeSubmission({ is_first: { new: false }, created_via: { new: "manual" } })).toBe(
      "Lead details added again manually"
    );
  });

  it("keeps form wording for form submissions, including old entries with no created_via", () => {
    expect(describeSubmission({ is_first: { new: true }, form_name: { new: "UK Expo" } })).toBe("Lead created · Filled UK Expo");
    expect(describeSubmission({ is_first: { new: true } })).toBe("Lead created");
    expect(describeSubmission({ is_first: { new: false }, form_name: { new: null } })).toBe("Filled form");
  });
});

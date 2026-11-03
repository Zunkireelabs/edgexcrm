import { describe, it, expect } from "vitest";
import { isApplicationsGateError, parseGateMissing, moveErrorMessage } from "./gate-error";

describe("gate-error", () => {
  it("splits the gate message into items, keeping commas inside brackets together", () => {
    expect(
      parseGateMissing("Before moving to Applications, complete: Processing fee, Basic info (Name, Email, a document), Consent signed."),
    ).toEqual(["Processing fee", "Basic info (Name, Email, a document)", "Consent signed"]);
  });
  it("returns [] for a message that isn't the gate's", () => {
    expect(parseGateMissing("Failed to move lead")).toEqual([]);
  });
  it("recognises only the Applications gate 422", () => {
    const gate = { error: { message: "Validation failed", details: { applications: ["Before moving to Applications, complete: Processing fee."] } } };
    expect(isApplicationsGateError(gate)).toBe(true);
    expect(isApplicationsGateError({ error: { message: "nope" } })).toBe(false);
    expect(isApplicationsGateError(null)).toBe(false);
    expect(moveErrorMessage(gate, "x")).toContain("Processing fee");
  });
});

import { parseBasicInfoMissing } from "./gate-error";
describe("parseBasicInfoMissing", () => {
  it("returns the basic-info parts, or [] when basic info isn't missing", () => {
    expect(parseBasicInfoMissing(["Processing fee", "Basic info (Name, Study Information, a document)"])).toEqual(["Name", "Study Information", "a document"]);
    expect(parseBasicInfoMissing(["Consent signed"])).toEqual([]);
  });
});

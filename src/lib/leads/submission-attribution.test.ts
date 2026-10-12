import { describe, expect, it } from "vitest";
import { resolveSubmissionAttribution } from "./submission-attribution";

describe("resolveSubmissionAttribution", () => {
  it("attributes a dashboard session with no form config to the staff member as manual", () => {
    expect(resolveSubmissionAttribution({ dashboardUserId: "user-1", formConfigId: undefined })).toEqual({
      createdVia: "manual",
      actorUserId: "user-1",
    });
  });

  it("treats null / empty form config the same as absent", () => {
    expect(resolveSubmissionAttribution({ dashboardUserId: "user-1", formConfigId: null }).createdVia).toBe("manual");
    expect(resolveSubmissionAttribution({ dashboardUserId: "user-1", formConfigId: "" }).createdVia).toBe("manual");
  });

  it("keeps a logged-in staff member's public form submission as public_form with no actor", () => {
    expect(resolveSubmissionAttribution({ dashboardUserId: "user-1", formConfigId: "form-1" })).toEqual({
      createdVia: "public_form",
      actorUserId: null,
    });
  });

  it("keeps an anonymous widget submission as public_form", () => {
    expect(resolveSubmissionAttribution({ dashboardUserId: null, formConfigId: "form-1" })).toEqual({
      createdVia: "public_form",
      actorUserId: null,
    });
    expect(resolveSubmissionAttribution({ dashboardUserId: undefined, formConfigId: undefined }).createdVia).toBe("public_form");
  });
});

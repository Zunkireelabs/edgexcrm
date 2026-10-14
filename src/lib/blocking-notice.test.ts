import { describe, expect, it } from "vitest";
import { classifyApiError, parseMissingItems, profileIncompleteNotice, consentProfileIncompleteMessage } from "./blocking-notice";

describe("parseMissingItems", () => {
  it("reads the list the server puts after 'Missing:'", () => {
    expect(
      parseMissingItems("Complete the student profile before creating an application. Missing: Name, Email, Study Information, a document")
    ).toEqual(["Name", "Email", "Study Information", "a document"]);
  });

  it("handles a single item and a trailing full stop", () => {
    expect(parseMissingItems("Complete the student profile before creating an application. Missing: a document")).toEqual(["a document"]);
    expect(parseMissingItems("Missing: Phone.")).toEqual(["Phone"]);
  });

  it("returns an empty list when there is no 'Missing:' part, or no message", () => {
    expect(parseMissingItems("Something else")).toEqual([]);
    expect(parseMissingItems(null)).toEqual([]);
    expect(parseMissingItems(undefined)).toEqual([]);
  });
});

describe("profileIncompleteNotice", () => {
  it("lists each missing item with a hint on where to fix it", () => {
    const notice = profileIncompleteNotice(["Email", "a document"]);
    expect(notice.title).toBe("Complete the student profile first");
    expect(notice.items).toEqual([
      { label: "Email", hint: expect.stringContaining("Edit") },
      { label: "a document", hint: expect.stringContaining("Documents") },
    ]);
  });

  it("still lists an item it has no hint for", () => {
    expect(profileIncompleteNotice(["Something new"]).items).toEqual([{ label: "Something new", hint: undefined }]);
  });
});

describe("classifyApiError", () => {
  it("shows PROFILE_INCOMPLETE as a big pop-up with the missing items", () => {
    const result = classifyApiError({ code: "PROFILE_INCOMPLETE", message: "Complete the student profile before creating an application. Missing: a document" });
    expect(result.kind).toBe("blocking");
    if (result.kind === "blocking") {
      expect(result.notice.items?.map((i) => i.label)).toEqual(["a document"]);
    }
  });

  it("shows CONSENT_REQUIRED and ALREADY_SIGNED as big pop-ups", () => {
    expect(classifyApiError({ code: "CONSENT_REQUIRED", message: "x" }).kind).toBe("blocking");
    expect(classifyApiError({ code: "ALREADY_SIGNED", message: "x" }).kind).toBe("blocking");
  });

  it("keeps every other error as a normal toast, with the server's message", () => {
    expect(classifyApiError({ code: "DB_ERROR", message: "Failed to save" })).toEqual({ kind: "toast", message: "Failed to save" });
    expect(classifyApiError({ code: "VALIDATION_ERROR", message: "Name is required" })).toEqual({ kind: "toast", message: "Name is required" });
  });

  it("falls back to a default message when the error has none", () => {
    expect(classifyApiError({ code: "DB_ERROR" })).toEqual({ kind: "toast", message: "Something went wrong" });
    expect(classifyApiError(null, "Failed to add application")).toEqual({ kind: "toast", message: "Failed to add application" });
  });
});

describe("consent-blocked pop-up", () => {
  it("explains the guardian and counselor items in plain words, and leaves obvious ones bare", () => {
    const result = classifyApiError({
      code: "PROFILE_INCOMPLETE_FOR_CONSENT",
      message: consentProfileIncompleteMessage(["Passport Number", "Guardian Relationship", "Assigned Counselor"]),
    });
    expect(result.kind).toBe("blocking");
    if (result.kind !== "blocking") return;
    const items = result.notice.items ?? [];
    expect(items.map((i) => i.label)).toEqual(["Passport Number", "Guardian Relationship", "Assigned Counselor"]);
    expect(items[0].hint).toBeUndefined();
    expect(items[1].hint).toContain("None / Not applicable");
    expect(items[2].hint).toContain("Assign a counselor");
  });
});


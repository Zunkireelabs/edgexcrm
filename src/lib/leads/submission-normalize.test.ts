import { describe, it, expect } from "vitest";
import { resolveEmail, foldUnknownFieldsIntoCustomFields } from "./submission-normalize";

describe("resolveEmail", () => {
  it("prefers the canonical `email` key when present", () => {
    expect(resolveEmail({ email: "a@b.com", work_email: "c@d.com" })).toBe("a@b.com");
  });

  it("falls back to a known synonym key sent at the top level", () => {
    // Regression guard: zunkireelabs.com's contact form sends `work_email` with no
    // `email` key and no `custom_fields` wrapper at all.
    expect(resolveEmail({ work_email: "yukta@zunkireelabs.com" })).toBe("yukta@zunkireelabs.com");
  });

  it("falls back to a known synonym key nested under custom_fields", () => {
    expect(resolveEmail({ custom_fields: { contact_email: "a@b.com" } })).toBe("a@b.com");
  });

  it("returns null when neither the canonical key nor any synonym is present", () => {
    expect(resolveEmail({ phone: "123" })).toBeNull();
  });

  it("ignores a blank string value", () => {
    expect(resolveEmail({ email: "  ", work_email: "a@b.com" })).toBe("a@b.com");
  });
});

describe("foldUnknownFieldsIntoCustomFields", () => {
  it("moves an unrecognized top-level key into custom_fields", () => {
    // Regression guard: a hand-built external integration posting extra questions as
    // loose top-level keys (not nested under custom_fields) previously lost that data
    // entirely — it matched no recognized key and was never captured anywhere.
    const result = foldUnknownFieldsIntoCustomFields({
      first_name: "Yukta",
      how_would_you_like_to_connect_with_us: "Talk to AI Expert",
      opt_in_for_marketing_communication: false,
    });
    expect(result).toEqual({
      how_would_you_like_to_connect_with_us: "Talk to AI Expert",
      opt_in_for_marketing_communication: false,
    });
  });

  it("leaves recognized standard keys out of custom_fields", () => {
    const result = foldUnknownFieldsIntoCustomFields({
      first_name: "A",
      email: "a@b.com",
      phone: "123",
      city: "Kathmandu",
      country: "Nepal",
    });
    expect(result).toEqual({});
  });

  it("excludes caller-supplied extra known keys (e.g. an email synonym already promoted)", () => {
    const result = foldUnknownFieldsIntoCustomFields(
      { work_email: "a@b.com", timeline: "Q1" },
      ["work_email"]
    );
    expect(result).toEqual({ timeline: "Q1" });
  });

  it("merges with an existing custom_fields object without overwriting explicit entries", () => {
    const result = foldUnknownFieldsIntoCustomFields({
      custom_fields: { service_interest: "Web Dev" },
      timeline: "Q1",
    });
    expect(result).toEqual({ service_interest: "Web Dev", timeline: "Q1" });
  });
});

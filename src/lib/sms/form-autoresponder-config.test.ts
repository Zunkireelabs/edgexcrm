import { describe, it, expect } from "vitest";
import {
  estimateRenderedBody,
  MERGE_TAG_ESTIMATE_CHARS,
  normalizeSmsAutoresponder,
  SMS_AUTORESPONDER_BODY_MAX,
  SMS_AUTORESPONDER_DEFAULTS,
} from "./form-autoresponder-config";

describe("normalizeSmsAutoresponder", () => {
  const stored = { enabled: true, fire_mode: "first" as const, body: "Hi {{first_name}}" };

  it("no prior config + partial input applies defaults", () => {
    expect(normalizeSmsAutoresponder(undefined, { enabled: true })).toEqual({ ...SMS_AUTORESPONDER_DEFAULTS, enabled: true });
  });

  it("an omitted key is left alone", () => {
    expect(normalizeSmsAutoresponder(stored, { enabled: false })).toEqual({ ...stored, enabled: false });
    expect(normalizeSmsAutoresponder(stored, { body: "New" })).toEqual({ ...stored, body: "New" });
  });

  it("only 'first' selects first; anything else is every", () => {
    expect(normalizeSmsAutoresponder(stored, { fire_mode: "every" }).fire_mode).toBe("every");
    expect(normalizeSmsAutoresponder(stored, { fire_mode: "bogus" }).fire_mode).toBe("every");
  });

  it("caps the body length", () => {
    const out = normalizeSmsAutoresponder(stored, { body: "x".repeat(SMS_AUTORESPONDER_BODY_MAX + 500) });
    expect(out.body).toHaveLength(SMS_AUTORESPONDER_BODY_MAX);
  });

  it("ignores a non-string body and non-object input instead of storing it", () => {
    expect(normalizeSmsAutoresponder(stored, { body: 123 })).toEqual(stored);
    expect(normalizeSmsAutoresponder(stored, "nope")).toEqual(stored);
    expect(normalizeSmsAutoresponder(stored, ["x"])).toEqual(stored);
    expect(normalizeSmsAutoresponder(stored, null)).toEqual(stored);
  });

  it("drops unknown keys", () => {
    const out = normalizeSmsAutoresponder(stored, { evil: "<script>", tenant_id: "x" });
    expect(Object.keys(out).sort()).toEqual(["body", "enabled", "fire_mode"]);
  });
});

describe("estimateRenderedBody", () => {
  it("replaces each merge tag with a fixed-width stand-in, so braces are never counted", () => {
    const out = estimateRenderedBody("Hi {{first_name}} {{ last_name }}!");
    expect(out).toBe(`Hi ${"x".repeat(MERGE_TAG_ESTIMATE_CHARS)} ${"x".repeat(MERGE_TAG_ESTIMATE_CHARS)}!`);
    expect(out).not.toMatch(/[{}]/);
  });

  it("leaves text without tags alone, and only matches real tag shapes", () => {
    expect(estimateRenderedBody("Thanks!")).toBe("Thanks!");
    expect(estimateRenderedBody("{not a tag} {{}}")).toBe("{not a tag} {{}}");
  });
});

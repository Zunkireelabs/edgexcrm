import { describe, it, expect } from "vitest";
import { normalizeAutoresponder } from "./route";

describe("normalizeAutoresponder", () => {
  const stored = {
    enabled: true,
    fire_mode: "every" as const,
    subject: "Welcome!",
    body_html: "<html><body>Hi</body></html>",
    body_format: "html" as const,
  };

  it("partial PATCH { enabled: false } preserves body_format, subject, body_html", () => {
    const result = normalizeAutoresponder(stored, { enabled: false });
    expect(result).toEqual({ ...stored, enabled: false });
  });

  it("partial PATCH { body_html } preserves body_format", () => {
    const result = normalizeAutoresponder(stored, { body_html: "<html>new</html>" });
    expect(result.body_format).toBe("html");
    expect(result.body_html).toBe("<html>new</html>");
    expect(result.subject).toBe(stored.subject);
    expect(result.enabled).toBe(stored.enabled);
  });

  it("full PATCH with all five keys behaves as before (full replace)", () => {
    const full = {
      enabled: false,
      fire_mode: "first",
      subject: "New subject",
      body_html: "<p>new</p>",
      body_format: "text",
    };
    const result = normalizeAutoresponder(stored, full);
    expect(result).toEqual({
      enabled: false,
      fire_mode: "first",
      subject: "New subject",
      body_html: "<p>new</p>",
      body_format: "text",
    });
  });

  it("autoresponder: null resets all five keys to defaults", () => {
    const result = normalizeAutoresponder(stored, null);
    expect(result).toEqual({
      enabled: false,
      fire_mode: "every",
      subject: "",
      body_html: "",
      body_format: "text",
    });
  });

  it("no prior autoresponder + partial PATCH applies old defaults, no crash", () => {
    const result = normalizeAutoresponder(undefined, { enabled: true });
    expect(result).toEqual({
      enabled: true,
      fire_mode: "every",
      subject: "",
      body_html: "",
      body_format: "text",
    });
  });

  it("no prior autoresponder (null) + partial PATCH applies old defaults", () => {
    const result = normalizeAutoresponder(null, { body_format: "html" });
    expect(result).toEqual({
      enabled: false,
      fire_mode: "every",
      subject: "",
      body_html: "",
      body_format: "html",
    });
  });

  it("enforces length caps on caller-supplied subject and body_html", () => {
    const longSubject = "a".repeat(2000);
    const longBody = "b".repeat(200_000);
    const result = normalizeAutoresponder(stored, { subject: longSubject, body_html: longBody });
    expect(result.subject.length).toBe(998);
    expect(result.body_html.length).toBe(100_000);
  });

  it("does not re-cap a previously stored value that was left alone", () => {
    const alreadyLong = { ...stored, subject: "x".repeat(998), body_html: "y".repeat(100_000) };
    const result = normalizeAutoresponder(alreadyLong, { enabled: false });
    expect(result.subject).toBe(alreadyLong.subject);
    expect(result.body_html).toBe(alreadyLong.body_html);
  });
});

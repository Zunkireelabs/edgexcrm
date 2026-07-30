import { describe, it, expect } from "vitest";
import { sanitizeDisplayName } from "./reply-to-label";

describe("sanitizeDisplayName", () => {
  it("returns null for null/undefined/empty input", () => {
    expect(sanitizeDisplayName(null)).toBeNull();
    expect(sanitizeDisplayName(undefined)).toBeNull();
    expect(sanitizeDisplayName("")).toBeNull();
  });

  it("passes through an ordinary name unchanged", () => {
    expect(sanitizeDisplayName("Sadin Shrestha")).toBe("Sadin Shrestha");
  });

  it("strips CR/LF and collapses the injected header (CRLF header-injection payload)", () => {
    const payload = "Rep\r\nBcc: attacker@evil.com";
    expect(sanitizeDisplayName(payload)).toBe("Rep Bcc: attacker@evil.com");
  });

  it("strips quotes, backslashes, and angle brackets", () => {
    expect(sanitizeDisplayName('Rep "Nickname" <injected>\\')).toBe("Rep Nickname injected");
  });

  it("collapses internal whitespace runs to a single space", () => {
    expect(sanitizeDisplayName("Rep   Person\t\tHere")).toBe("Rep Person Here");
  });

  it("trims leading/trailing whitespace", () => {
    expect(sanitizeDisplayName("   Rep Person   ")).toBe("Rep Person");
  });

  it("caps length at 64 chars", () => {
    const long = "A".repeat(100);
    const result = sanitizeDisplayName(long);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(64);
  });

  it("returns null (not empty string) for all-punctuation input that reduces to nothing usable", () => {
    expect(sanitizeDisplayName('"<>\\\r\n')).toBeNull();
  });

  it("returns null for input that is only whitespace after stripping", () => {
    expect(sanitizeDisplayName("   \r\n   ")).toBeNull();
  });
});

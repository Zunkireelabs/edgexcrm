import { describe, it, expect } from "vitest";
import { looksLikeHtml } from "./render-template";

describe("looksLikeHtml", () => {
  it("returns false for plain multi-line text", () => {
    expect(looksLikeHtml("Hi {{first_name}},\n\nWe received your enquiry.")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(looksLikeHtml("")).toBe(false);
  });

  it("returns true for a full pasted HTML document", () => {
    const doc = "<html><head></head><body><p>Hi {{first_name}}</p></body></html>";
    expect(looksLikeHtml(doc)).toBe(true);
  });

  it("returns true for a body fragment starting with a block tag", () => {
    expect(looksLikeHtml('<div style="color:red">Hi {{first_name}}</div>')).toBe(true);
  });

  it("returns true even when the tag appears mid-string", () => {
    expect(looksLikeHtml("Hi {{first_name}}, here is a link: <a href=\"#\">click</a>")).toBe(true);
  });

  it("does not false-positive on a merge tag alone", () => {
    expect(looksLikeHtml("Hi {{first_name}}, thanks!")).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { uploadErrorMessage, UPLOAD_URL_FALLBACK } from "./upload-error-message";

describe("uploadErrorMessage", () => {
  it("shows the real reason from validation details (too large / wrong type), not 'Validation failed'", () => {
    expect(uploadErrorMessage({ error: { code: "VALIDATION_ERROR", message: "Validation failed", details: { file_size: ["File too large. Maximum size is 10MB"] } } })).toBe(
      "File too large. Maximum size is 10MB"
    );
    expect(uploadErrorMessage({ error: { message: "Validation failed", details: { mime_type: ['File type "image/heic" is not accepted. Allowed: application/pdf, image/jpeg'] } } })).toContain("is not accepted");
  });

  it("gives a plain-words message when rate limited", () => {
    expect(uploadErrorMessage({ error: { code: "RATE_LIMITED", message: "Too many requests" } })).toMatch(/wait a few minutes/i);
  });

  it("uses the server's own message for other failures (e.g. storage down)", () => {
    expect(uploadErrorMessage({ error: { code: "SERVICE_UNAVAILABLE", message: "Failed to generate upload URL" } })).toBe("Failed to generate upload URL");
  });

  it("falls back to the generic text when there is nothing useful (no body, junk body, empty details)", () => {
    expect(uploadErrorMessage(null)).toBe(UPLOAD_URL_FALLBACK);
    expect(uploadErrorMessage({})).toBe(UPLOAD_URL_FALLBACK);
    expect(uploadErrorMessage({ error: { message: "Validation failed", details: {} } })).toBe(UPLOAD_URL_FALLBACK);
    expect(uploadErrorMessage({ error: { message: "   " } })).toBe(UPLOAD_URL_FALLBACK);
  });
});

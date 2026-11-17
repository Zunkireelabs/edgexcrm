import { describe, it, expect } from "vitest";
import { isTransientProviderError, isTransientErrorMessage } from "./transient-errors";

describe("isTransientProviderError", () => {
  it("flags AI-SDK style statusCode 429 and 5xx", () => {
    expect(isTransientProviderError(Object.assign(new Error("x"), { statusCode: 429 }))).toBe(true);
    expect(isTransientProviderError(Object.assign(new Error("x"), { status: 503 }))).toBe(true);
  });
  it("flags quota / rate-limit wording and nested causes", () => {
    expect(isTransientProviderError(new Error("You exceeded your current quota"))).toBe(true);
    expect(isTransientProviderError(new Error("outer", { cause: new Error("Rate limit reached") }))).toBe(true);
  });
  it("does not flag genuine file/parse problems", () => {
    expect(isTransientProviderError(new Error("provider does not support file parts"))).toBe(false);
    expect(isTransientProviderError(Object.assign(new Error("bad"), { statusCode: 400 }))).toBe(false);
    expect(isTransientProviderError(null)).toBe(false);
    expect(isTransientProviderError("429")).toBe(false);
  });
});

describe("isTransientErrorMessage", () => {
  it("matches the stored OpenAI 429 text staff saw", () => {
    expect(isTransientErrorMessage('OpenAI embeddings request failed (429): { "error": { "message": "You have no quota"')).toBe(true);
  });
  it("does not match unrelated or empty errors", () => {
    expect(isTransientErrorMessage("Unsupported mime type for parsing: image/gif")).toBe(false);
    expect(isTransientErrorMessage(null)).toBe(false);
  });
});

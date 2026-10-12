import { describe, expect, it } from "vitest";
import { NATIONALITY_OPTIONS } from "./contact-options";

describe("NATIONALITY_OPTIONS", () => {
  it("lists real countries as plain names, Nepal first", () => {
    expect(NATIONALITY_OPTIONS[0]).toEqual({ value: "Nepal", label: "Nepal" });
    expect(NATIONALITY_OPTIONS.length).toBeGreaterThan(100);
  });

  it("has no duplicate values", () => {
    const values = NATIONALITY_OPTIONS.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });
});

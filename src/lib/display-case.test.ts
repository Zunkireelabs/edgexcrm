import { describe, expect, it } from "vitest";
import { displayCase } from "./display-case";

describe("displayCase", () => {
  it("capitalizes lowercase words", () => {
    expect(displayCase("nepal")).toBe("Nepal");
    expect(displayCase("united arab emirates")).toBe("United Arab Emirates");
  });

  it("leaves values that already have capitals exactly as stored", () => {
    expect(displayCase("Nepal")).toBe("Nepal");
    expect(displayCase("USA")).toBe("USA");
    expect(displayCase("McLean")).toBe("McLean");
    expect(displayCase("new YORK")).toBe("New YORK");
  });

  it("keeps small joiners lowercase, but not at the start", () => {
    expect(displayCase("republic of ireland")).toBe("Republic of Ireland");
    expect(displayCase("the gambia")).toBe("The Gambia");
  });

  it("capitalizes each part of a hyphenated name", () => {
    expect(displayCase("guinea-bissau")).toBe("Guinea-Bissau");
  });

  it("returns an empty string for missing values and preserves spacing", () => {
    expect(displayCase(null)).toBe("");
    expect(displayCase(undefined)).toBe("");
    expect(displayCase("")).toBe("");
    expect(displayCase("  nepal ")).toBe("  Nepal ");
  });
});

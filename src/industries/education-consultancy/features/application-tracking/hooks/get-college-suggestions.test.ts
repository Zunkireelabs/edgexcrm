import { describe, it, expect } from "vitest";
import { getCollegeSuggestions, type PartnerCollegeOption } from "./use-application-reference-data";

// A destination saved as "uk" must still rank colleges tagged "UK" first (case-insensitive match).
const college = (name: string, country: string | null) => ({ id: name, name, country }) as unknown as PartnerCollegeOption;

describe("getCollegeSuggestions", () => {
  const colleges = [college("Sydney Uni", "Australia"), college("Oxford", "UK"), college("Untagged", null)];

  it("ranks colleges tagged to the destination first, ignoring case", () => {
    expect(getCollegeSuggestions(colleges, ["uk"])).toEqual(["Oxford", "Untagged", "Sydney Uni"]);
  });
  it("exact case still works", () => {
    expect(getCollegeSuggestions(colleges, ["UK"])).toEqual(["Oxford", "Untagged", "Sydney Uni"]);
  });
  it("never drops a college", () => {
    expect(getCollegeSuggestions(colleges, ["Narnia"]).sort()).toEqual(["Oxford", "Sydney Uni", "Untagged"]);
  });
  it("no destination selected: all colleges in order", () => {
    expect(getCollegeSuggestions(colleges, [])).toEqual(["Sydney Uni", "Oxford", "Untagged"]);
  });
});

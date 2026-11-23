import { describe, expect, it } from "vitest";
import { computeMissingDocuments } from "./missing";

describe("computeMissingDocuments", () => {
  it("is not assessable without a required list", () => {
    expect(computeMissingDocuments([], ["passport"])).toEqual({ assessable: false, missing: [] });
    expect(computeMissingDocuments(null, [])).toEqual({ assessable: false, missing: [] });
  });
  it("returns required types not on file, in required order", () => {
    expect(computeMissingDocuments(["passport", "cv", "transcript"], ["cv"])).toEqual({
      assessable: true,
      missing: ["passport", "transcript"],
    });
  });
  it("is complete when everything is on file", () => {
    expect(computeMissingDocuments(["cv"], new Set(["cv", "other"]))).toEqual({ assessable: true, missing: [] });
  });
});

import { describe, expect, it } from "vitest";
import { getLeadCountry, getLeadLocationRows } from "./lead-location";

describe("getLeadLocationRows", () => {
  it("returns Nationality then City when both exist", () => {
    expect(getLeadLocationRows({ city: "Dhanusha", nationality: "Nepal" })).toEqual([
      { label: "Nationality", value: "Nepal" },
      { label: "City", value: "Dhanusha" },
    ]);
  });

  it("omits a row whose value is missing or blank", () => {
    expect(getLeadLocationRows({ city: null, nationality: "Nepal" })).toEqual([{ label: "Nationality", value: "Nepal" }]);
    expect(getLeadLocationRows({ city: "  ", nationality: "Nepal" })).toEqual([{ label: "Nationality", value: "Nepal" }]);
    expect(getLeadLocationRows({ city: "Pokhara", nationality: null })).toEqual([{ label: "City", value: "Pokhara" }]);
  });

  it("returns no rows when neither exists", () => {
    expect(getLeadLocationRows({ city: null, nationality: null })).toEqual([]);
  });

  it("falls back to legacy custom_fields values like the rest of the app", () => {
    expect(
      getLeadLocationRows({ city: null, nationality: null, custom_fields: { city: "Kathmandu", nationality: "Nepal" } })
    ).toEqual([
      { label: "Nationality", value: "Nepal" },
      { label: "City", value: "Kathmandu" },
    ]);
  });
});

describe("getLeadCountry", () => {
  it("prefers an older lead's saved Residence Country", () => {
    expect(getLeadCountry({ country: "India", nationality: "Nepal" })).toBe("India");
  });

  it("falls back to Nationality when there is no Residence Country", () => {
    expect(getLeadCountry({ country: null, nationality: "Nepal" })).toBe("Nepal");
    expect(getLeadCountry({ country: "  ", nationality: "Nepal" })).toBe("Nepal");
  });

  it("returns null when neither is set", () => {
    expect(getLeadCountry({ country: null, nationality: null })).toBeNull();
  });
});

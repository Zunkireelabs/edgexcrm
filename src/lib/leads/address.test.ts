import { describe, expect, it } from "vitest";
import {
  EMPTY_ADDRESS,
  addressContainsCity,
  applyAddressChange,
  cityFromMunicipality,
  districtOptions,
  formatAddress,
  isNepal,
  municipalityOptions,
  nextCity,
  stripTrailingCountry,
  updateAddress,
  wardOptions,
  type AddressParts,
  type AddressState,
} from "./address";

const full: AddressParts = {
  country: "Nepal",
  province: "Bagmati",
  district: "Kathmandu",
  municipality: "Kathmandu Metropolitan City",
  ward: "5",
  tole: "Baneshwor",
};

describe("cascading options", () => {
  it("filters districts by province and municipalities by district", () => {
    expect(districtOptions("Bagmati")).toContain("Kathmandu");
    expect(districtOptions("Bagmati")).not.toContain("Jhapa");
    expect(municipalityOptions("Kathmandu").map((u) => u.name)).toContain("Kathmandu Metropolitan City");
    expect(districtOptions("")).toEqual([]);
    expect(municipalityOptions("Nowhere")).toEqual([]);
  });

  it("offers ward numbers 1..N for the chosen municipality only", () => {
    expect(wardOptions("Kathmandu", "Kathmandu Metropolitan City")).toHaveLength(32);
    expect(wardOptions("Kathmandu", "Kathmandu Metropolitan City")[0]).toBe("1");
    expect(wardOptions("Kathmandu", "Kathmandu Metropolitan City")[31]).toBe("32");
    expect(wardOptions("Kathmandu", "")).toEqual([]);
    expect(wardOptions("Kathmandu", "Not A Municipality")).toEqual([]);
  });
});

describe("applyAddressChange clears dependents", () => {
  it("clears district, municipality and ward when the province changes, keeping the tole", () => {
    expect(applyAddressChange(full, "province", "Koshi")).toEqual({
      ...full, province: "Koshi", district: "", municipality: "", ward: "",
    });
  });

  it("clears municipality and ward when the district changes", () => {
    expect(applyAddressChange(full, "district", "Lalitpur")).toEqual({ ...full, district: "Lalitpur", municipality: "", ward: "" });
  });

  it("clears the ward when the municipality changes", () => {
    expect(applyAddressChange(full, "municipality", "Budhanilkantha Municipality").ward).toBe("");
  });

  it("changing ward or tole clears nothing else", () => {
    expect(applyAddressChange(full, "ward", "6")).toEqual({ ...full, ward: "6" });
    expect(applyAddressChange(full, "tole", "Tinkune")).toEqual({ ...full, tole: "Tinkune" });
  });

  it("clears every part when the country changes", () => {
    expect(applyAddressChange(full, "country", "India")).toEqual({ ...EMPTY_ADDRESS, country: "India" });
  });

  it("returns the same object when nothing changed", () => {
    expect(applyAddressChange(full, "province", "Bagmati")).toBe(full);
  });
});

describe("formatAddress", () => {
  it("builds Tole, Ward, Municipality, District, Province, Country", () => {
    expect(formatAddress(full)).toBe("Baneshwor, Ward 5, Kathmandu Metropolitan City, Kathmandu, Bagmati, Nepal");
  });

  it("skips empty parts", () => {
    expect(formatAddress({ ...EMPTY_ADDRESS, country: "Nepal", province: "Koshi" })).toBe("Koshi, Nepal");
    expect(formatAddress(EMPTY_ADDRESS)).toBe("");
  });
});

describe("City from municipality", () => {
  it("drops the type suffix", () => {
    expect(cityFromMunicipality("Kathmandu Metropolitan City")).toBe("Kathmandu");
    expect(cityFromMunicipality("Pokhara Metropolitan City")).toBe("Pokhara");
    expect(cityFromMunicipality("Dhangadhi Sub-Metropolitan City")).toBe("Dhangadhi");
    expect(cityFromMunicipality("Bhojpur Municipality")).toBe("Bhojpur");
    expect(cityFromMunicipality("Badhaiyatal Rural Municipality")).toBe("Badhaiyatal");
  });

  it("fills an empty City", () => {
    expect(nextCity("", "", "Kathmandu Metropolitan City")).toBe("Kathmandu");
  });

  it("follows the municipality while City is still the auto-filled value", () => {
    expect(nextCity("Kathmandu", "Kathmandu Metropolitan City", "Budhanilkantha Municipality")).toBe("Budhanilkantha");
  });

  it("never overwrites a City someone typed", () => {
    expect(nextCity("Thamel", "Kathmandu Metropolitan City", "Budhanilkantha Municipality")).toBe("Thamel");
  });

  it("keeps City when the municipality is cleared", () => {
    expect(nextCity("Kathmandu", "Kathmandu Metropolitan City", "")).toBe("Kathmandu");
  });
});

describe("updateAddress keeps full_address consistent", () => {
  const start: AddressState = { parts: { ...EMPTY_ADDRESS, country: "Nepal" }, fullAddress: "" };

  it("composes the full address as parts are picked in Nepal", () => {
    let s = updateAddress(start, "province", "Bagmati");
    expect(s.fullAddress).toBe("Bagmati, Nepal");
    s = updateAddress(s, "district", "Kathmandu");
    s = updateAddress(s, "municipality", "Kathmandu Metropolitan City");
    s = updateAddress(s, "ward", "5");
    s = updateAddress(s, "tole", "Baneshwor");
    expect(s.fullAddress).toBe("Baneshwor, Ward 5, Kathmandu Metropolitan City, Kathmandu, Bagmati, Nepal");
  });

  it("drops the stale pieces when a parent changes", () => {
    const s = updateAddress({ parts: full, fullAddress: formatAddress(full) }, "province", "Koshi");
    expect(s.parts.district).toBe("");
    expect(s.fullAddress).toBe("Baneshwor, Koshi, Nepal");
  });

  it("keeps a hand-typed old address until Nepal parts are picked", () => {
    const old: AddressState = { parts: { ...EMPTY_ADDRESS, country: "Nepal" }, fullAddress: "Near the temple, Birgunj" };
    expect(updateAddress(old, "country", "Nepal")).toBe(old);
    expect(updateAddress(old, "province", "Madhesh").fullAddress).toBe("Madhesh, Nepal");
  });

  it("drops a composed address when the country changes, but keeps a typed one", () => {
    const composed = updateAddress({ parts: full, fullAddress: formatAddress(full) }, "country", "India");
    expect(composed.fullAddress).toBe("");
    expect(composed.parts).toEqual({ ...EMPTY_ADDRESS, country: "India" });
    const typed = updateAddress({ parts: full, fullAddress: "My own text" }, "country", "India");
    expect(typed.fullAddress).toBe("My own text");
  });

  it("does not compose for other countries", () => {
    const s = updateAddress({ parts: { ...EMPTY_ADDRESS, country: "India" }, fullAddress: "12 MG Road" }, "tole", "x");
    expect(s.fullAddress).toBe("12 MG Road");
  });

  it("clears the composed address when every part is cleared", () => {
    const one = updateAddress(start, "province", "Koshi");
    expect(updateAddress(one, "province", "").fullAddress).toBe("");
  });
});

describe("isNepal", () => {
  it("matches Nepal regardless of case or spacing", () => {
    expect(isNepal("Nepal")).toBe(true);
    expect(isNepal(" nepal ")).toBe(true);
    expect(isNepal("India")).toBe(false);
    expect(isNepal(null)).toBe(false);
    expect(isNepal("")).toBe(false);
  });
});

// The composed Nepal address ends with the country ("…, Bagmati, Nepal"); the card and the consent form also show the country
// separately, so the country printed twice. stripTrailingCountry removes the repeat at display/merge time (saved data untouched).
describe("stripTrailingCountry", () => {
  it("drops the trailing country — the exact address from the client's screenshot", () => {
    expect(
      stripTrailingCountry("Sunar Gaun, Ward 14, Kathmandu Metropolitan City, Kathmandu, Bagmati, Nepal", "Nepal"),
    ).toBe("Sunar Gaun, Ward 14, Kathmandu Metropolitan City, Kathmandu, Bagmati");
  });

  it("works on what formatAddress() composes", () => {
    expect(stripTrailingCountry(formatAddress(full), "Nepal")).toBe("Baneshwor, Ward 5, Kathmandu Metropolitan City, Kathmandu, Bagmati");
  });

  it("ignores case and extra spaces", () => {
    expect(stripTrailingCountry("Bagmati,   NEPAL  ", " nepal ")).toBe("Bagmati");
  });

  it("cleans a repeated trailing country too", () => {
    expect(stripTrailingCountry("Bagmati, Nepal, Nepal", "Nepal")).toBe("Bagmati");
  });

  it("an address that is only the country becomes empty", () => {
    expect(stripTrailingCountry("Nepal", "Nepal")).toBe("");
  });

  it("leaves an address that does not end with the country untouched", () => {
    expect(stripTrailingCountry("12 Main St, London", "UK")).toBe("12 Main St, London");
    expect(stripTrailingCountry("Bagmati, Nepal, Kathmandu", "Nepal")).toBe("Bagmati, Nepal, Kathmandu");
  });

  it("never matches part of a word (Nepal vs Nepalgunj)", () => {
    expect(stripTrailingCountry("Birta, Nepalgunj", "Nepal")).toBe("Birta, Nepalgunj");
  });

  it("matches a country whose own name contains a comma (free-text country values)", () => {
    expect(stripTrailingCountry("Gangnam, Seoul, Korea, South", "Korea, South")).toBe("Gangnam, Seoul");
    expect(stripTrailingCountry("Seoul, korea, south", "Korea, South")).toBe("Seoul");
    expect(stripTrailingCountry("Korea, South", "Korea, South")).toBe("");
  });

  it("does not match when the country is only the end of a longer word or name", () => {
    expect(stripTrailingCountry("Birta, Nepalgunj", "Nepal")).toBe("Birta, Nepalgunj");
    expect(stripTrailingCountry("Port Nepal", "Nepal")).toBe("Port Nepal");
    expect(stripTrailingCountry("Bagmati,Nepal", "Nepal")).toBe("Bagmati");
    expect(stripTrailingCountry("South Korea", "Korea, South")).toBe("South Korea");
    expect(stripTrailingCountry("Seoul, Korea", "Korea, South")).toBe("Seoul, Korea");
  });

  it("does nothing without a country, or without an address", () => {
    expect(stripTrailingCountry("Bagmati, Nepal", "")).toBe("Bagmati, Nepal");
    expect(stripTrailingCountry("Bagmati, Nepal", null)).toBe("Bagmati, Nepal");
    expect(stripTrailingCountry("", "Nepal")).toBe("");
    expect(stripTrailingCountry(null, "Nepal")).toBe("");
    expect(stripTrailingCountry(undefined, undefined)).toBe("");
  });
});

// A Nepal address already contains its municipality and City is filled from it, so a document that prints both showed the city twice.
describe("addressContainsCity", () => {
  it("finds the city inside the municipality name", () => {
    expect(addressContainsCity("Ward 14, Birgunj Metropolitan City, Parsa, Madhesh, Nepal", "Birgunj")).toBe(true);
  });

  it("ignores case and surrounding spaces", () => {
    expect(addressContainsCity("ward 14, BIRGUNJ Metropolitan City", "  birgunj ")).toBe(true);
  });

  it("matches a city that is a whole comma-separated part", () => {
    expect(addressContainsCity("Baneshwor, Kathmandu", "Kathmandu")).toBe(true);
  });

  it("is a whole-word match: Lalit is not inside Lalitpur", () => {
    expect(addressContainsCity("Ward 3, Lalitpur Metropolitan City, Lalitpur", "Lalit")).toBe(false);
  });

  it("does not match when the city is only the tail of a longer word", () => {
    expect(addressContainsCity("Ward 1, Nepalgunj", "gunj")).toBe(false);
  });

  it("is false when the city is not in the address", () => {
    expect(addressContainsCity("12 Main St, Parsa", "Birgunj")).toBe(false);
  });

  it("is false for a blank or missing city or address", () => {
    expect(addressContainsCity("Birgunj", "")).toBe(false);
    expect(addressContainsCity("Birgunj", null)).toBe(false);
    expect(addressContainsCity("", "Birgunj")).toBe(false);
    expect(addressContainsCity(undefined, "Birgunj")).toBe(false);
  });

  it("treats regex characters in a city name literally", () => {
    expect(addressContainsCity("Ward 1, St. (Old) Town", "St. (Old) Town")).toBe(true);
    expect(addressContainsCity("Ward 1, StX Town", "St. Town")).toBe(false);
  });
});

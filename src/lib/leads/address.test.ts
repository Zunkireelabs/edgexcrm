import { describe, expect, it } from "vitest";
import {
  EMPTY_ADDRESS,
  applyAddressChange,
  cityFromMunicipality,
  districtOptions,
  formatAddress,
  isNepal,
  municipalityOptions,
  nextCity,
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

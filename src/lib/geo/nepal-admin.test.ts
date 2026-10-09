import { describe, expect, it } from "vitest";
import { NEPAL_DISTRICTS, NEPAL_LOCAL_UNITS, NEPAL_PROVINCES } from "./nepal-admin";

const allDistricts = Object.values(NEPAL_DISTRICTS).flat();
const allUnits = Object.values(NEPAL_LOCAL_UNITS).flat();

describe("Nepal administrative data matches the official structure", () => {
  it("has 7 provinces, 77 districts and 753 local levels", () => {
    expect(NEPAL_PROVINCES).toHaveLength(7);
    expect(allDistricts).toHaveLength(77);
    expect(new Set(allDistricts).size).toBe(77);
    expect(allUnits).toHaveLength(753);
  });

  it("has the official number of districts in each province", () => {
    expect(NEPAL_PROVINCES.map((p) => NEPAL_DISTRICTS[p].length)).toEqual([14, 8, 13, 11, 12, 10, 9]);
  });

  it("has 6 metropolitan, 11 sub-metropolitan, 276 municipalities and 460 rural municipalities", () => {
    const count = (type: string) => allUnits.filter((u) => u.type === type).length;
    expect([count("metropolitan"), count("sub-metropolitan"), count("municipality"), count("rural-municipality")]).toEqual([
      6, 11, 276, 460,
    ]);
  });

  it("gives every district at least one local level, and no local level to an unknown district", () => {
    expect(Object.keys(NEPAL_LOCAL_UNITS).sort()).toEqual([...allDistricts].sort());
    for (const d of allDistricts) expect(NEPAL_LOCAL_UNITS[d].length).toBeGreaterThan(0);
  });

  it("gives every local level a positive whole number of wards", () => {
    for (const u of allUnits) {
      expect(Number.isInteger(u.wards)).toBe(true);
      expect(u.wards).toBeGreaterThanOrEqual(1);
    }
  });

  it("has unique local level names inside each district", () => {
    for (const [district, units] of Object.entries(NEPAL_LOCAL_UNITS)) {
      const names = units.map((u) => u.name);
      expect(new Set(names).size, district).toBe(names.length);
    }
  });

  it("knows well-known places", () => {
    expect(NEPAL_DISTRICTS.Bagmati).toContain("Kathmandu");
    const kmc = NEPAL_LOCAL_UNITS.Kathmandu.find((u) => u.name === "Kathmandu Metropolitan City");
    expect(kmc).toEqual({ name: "Kathmandu Metropolitan City", type: "metropolitan", wards: 32 });
    expect(NEPAL_DISTRICTS.Madhesh).toContain("Dhanusha");
  });
});

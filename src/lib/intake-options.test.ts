import { describe, expect, it } from "vitest";
import { buildIntakeTermOptions } from "./intake-options";

describe("buildIntakeTermOptions", () => {
  it("lists every month of one year before the next year starts", () => {
    const labels = buildIntakeTermOptions(["January", "February", "March"], ["2026", "2027"]).map((o) => o.label);
    expect(labels).toEqual([
      "January 2026", "February 2026", "March 2026",
      "January 2027", "February 2027", "March 2027",
    ]);
  });

  it("keeps value === label in the exact 'Month Year' form leads.intake_term stores", () => {
    for (const o of buildIntakeTermOptions(["November"], ["2026"])) {
      expect(o).toEqual({ value: "November 2026", label: "November 2026" });
    }
  });

  it("returns the full month x year set with no duplicates", () => {
    const months = ["January", "February", "March", "April"];
    const years = ["2026", "2027", "2028"];
    const values = buildIntakeTermOptions(months, years).map((o) => o.value);
    expect(values).toHaveLength(months.length * years.length);
    expect(new Set(values).size).toBe(values.length);
  });

  it("is empty when either catalog is empty", () => {
    expect(buildIntakeTermOptions([], ["2026"])).toEqual([]);
    expect(buildIntakeTermOptions(["January"], [])).toEqual([]);
  });
});

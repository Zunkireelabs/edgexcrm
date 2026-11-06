import { describe, it, expect } from "vitest";
import { getInitialFormData } from "./form-defaults";
import { isValidPhoneForCountry, formatPhoneForStorage } from "./phone-utils";
import type { FormStep } from "@/types/database";

const OPTIONS = [
  { label: "India", value: "india", dial_code: "+91" },
  { label: "Nepal", value: "nepal", dial_code: "+977" },
  { label: "Other", value: "other", dial_code: "" },
];

function steps(placeholder: string | undefined, link = true): FormStep[] {
  return [
    {
      fields: [
        { name: "country", type: "select", label: "Country", required: true, options: OPTIONS, placeholder },
        { name: "phone", type: "tel", label: "Phone", required: true, ...(link ? { country_field: "country" } : {}) },
      ],
    },
  ] as unknown as FormStep[];
}

describe("getInitialFormData — country placeholder becomes a real value", () => {
  it('"Nepal (NP)" placeholder preselects the Nepal option (the Admizz bug)', () => {
    expect(getInitialFormData(steps("Nepal (NP)"))).toEqual({ country: "nepal" });
  });

  it("is case/space tolerant", () => {
    expect(getInitialFormData(steps("  nepal  (np) "))).toEqual({ country: "nepal" });
  });

  it("a prompt-style placeholder defaults nothing (still a real prompt)", () => {
    expect(getInitialFormData(steps("Select country"))).toEqual({});
    expect(getInitialFormData(steps(undefined))).toEqual({});
  });

  it("does nothing when no phone field links to the select", () => {
    expect(getInitialFormData(steps("Nepal (NP)", false))).toEqual({});
  });

  it("does nothing when the placeholder names a country that isn't an option", () => {
    expect(getInitialFormData(steps("Bhutan (BT)"))).toEqual({});
  });
});

describe("phone validation with the Nepal default", () => {
  it("a valid Nepal mobile (98XXXXXXXX) passes with +977", () => {
    expect(isValidPhoneForCountry(formatPhoneForStorage("+977", "9812345678"))).toBe(true);
  });
  it("1234567890 is not a valid Nepal number", () => {
    expect(isValidPhoneForCountry(formatPhoneForStorage("+977", "1234567890"))).toBe(false);
  });
  it("a valid India mobile passes with +91", () => {
    expect(isValidPhoneForCountry(formatPhoneForStorage("+91", "9876543210"))).toBe(true);
  });
});

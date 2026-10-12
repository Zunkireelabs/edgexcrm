import { describe, expect, it } from "vitest";
import { PERSONAL_DETAIL_COLUMNS, coercePersonalDetailsPayload } from "./personal-details";

describe("coercePersonalDetailsPayload", () => {
  it("covers the 14 migration-234 columns, the 4 guardian columns (266, 269) and the 5 address columns (272)", () => {
    expect(PERSONAL_DETAIL_COLUMNS).toHaveLength(23);
  });

  it("saves the structured address parts as trimmed text and clears them with blanks", () => {
    const { values, errors } = coercePersonalDetailsPayload({
      address_province: " Bagmati ",
      address_district: "Kathmandu",
      address_municipality: "Kathmandu Metropolitan City",
      address_ward: "5",
      address_tole: "",
    });
    expect(errors).toEqual({});
    expect(values).toEqual({
      address_province: "Bagmati",
      address_district: "Kathmandu",
      address_municipality: "Kathmandu Metropolitan City",
      address_ward: "5",
      address_tole: null,
    });
  });

  it("only returns columns present in the body", () => {
    const { values, errors } = coercePersonalDetailsPayload({ passport_number: " PA1 ", first_name: "x" });
    expect(values).toEqual({ passport_number: "PA1" });
    expect(errors).toEqual({});
  });

  it("turns blanks and null into null", () => {
    const { values } = coercePersonalDetailsPayload({ father_name: "  ", mother_name: null, date_of_birth: "" });
    expect(values).toEqual({ father_name: null, mother_name: null, date_of_birth: null });
  });

  it("accepts a real date and rejects malformed / impossible ones", () => {
    expect(coercePersonalDetailsPayload({ date_of_birth: "2003-02-01" }).values.date_of_birth).toBe("2003-02-01");
    for (const bad of ["01/02/2003", "2003-13-01", "2003-02-30", "yesterday"]) {
      expect(coercePersonalDetailsPayload({ passport_expiry_date: bad }).errors.passport_expiry_date).toBeDefined();
    }
  });

  it("validates marital_status", () => {
    expect(coercePersonalDetailsPayload({ marital_status: "married" }).values.marital_status).toBe("married");
    expect(coercePersonalDetailsPayload({ marital_status: "complicated" }).errors.marital_status).toBeDefined();
  });

  it("validates guardian_email", () => {
    expect(coercePersonalDetailsPayload({ guardian_email: " g@example.com " }).values.guardian_email).toBe("g@example.com");
    expect(coercePersonalDetailsPayload({ guardian_email: "nope" }).errors.guardian_email).toBeDefined();
    expect(coercePersonalDetailsPayload({ guardian_email: "" }).values.guardian_email).toBeNull();
  });

  it("rejects non-string values and over-long text", () => {
    expect(coercePersonalDetailsPayload({ passport_number: 12345 }).errors.passport_number).toBeDefined();
    expect(coercePersonalDetailsPayload({ full_address: "a".repeat(501) }).errors.full_address).toBeDefined();
  });

  it("trims and nulls guardian_name like the other text columns, and length-limits it", () => {
    expect(coercePersonalDetailsPayload({ guardian_name: "  Hari Sharma " }).values).toEqual({ guardian_name: "Hari Sharma" });
    expect(coercePersonalDetailsPayload({ guardian_name: "" }).values).toEqual({ guardian_name: null });
    expect(coercePersonalDetailsPayload({ guardian_name: "x".repeat(501) }).errors.guardian_name).toBeDefined();
  });
});

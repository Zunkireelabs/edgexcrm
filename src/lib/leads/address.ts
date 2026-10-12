// Structured address for the Student Details pop-up (education_consultancy).
//
// Nepal students pick Province > District > Municipality > Ward and type a Tole; every other country
// keeps one free-text address box. Either way the readable address ends up in `full_address`, which is
// what consent and the rest of the app already read.

import {
  NEPAL_DISTRICTS,
  NEPAL_LOCAL_UNITS,
  NEPAL_PROVINCES,
  type NepalLocalUnit,
} from "@/lib/geo/nepal-admin";

export const NEPAL = "Nepal";

export interface AddressParts {
  country: string;
  province: string;
  district: string;
  municipality: string;
  ward: string;
  tole: string;
}

export type AddressField = keyof AddressParts;

export const EMPTY_ADDRESS: AddressParts = {
  country: "",
  province: "",
  district: "",
  municipality: "",
  ward: "",
  tole: "",
};

export function isNepal(country: string | null | undefined): boolean {
  return (country ?? "").trim().toLowerCase() === NEPAL.toLowerCase();
}

/** The leads columns that hold each part (country reuses the existing `country` column). */
export const ADDRESS_COLUMNS = {
  province: "address_province",
  district: "address_district",
  municipality: "address_municipality",
  ward: "address_ward",
  tole: "address_tole",
} as const;

export function provinceOptions(): readonly string[] {
  return NEPAL_PROVINCES;
}

export function districtOptions(province: string): readonly string[] {
  return NEPAL_DISTRICTS[province] ?? [];
}

export function municipalityOptions(district: string): readonly NepalLocalUnit[] {
  return NEPAL_LOCAL_UNITS[district] ?? [];
}

/** Ward numbers "1".."N" for the chosen municipality; empty until a known municipality is picked. */
export function wardOptions(district: string, municipality: string): readonly string[] {
  const unit = municipalityOptions(district).find((u) => u.name === municipality);
  return unit ? Array.from({ length: unit.wards }, (_, i) => String(i + 1)) : [];
}

// Order matters: a change to a parent clears everything below it, so a leftover child can never
// belong to a different parent than the one now selected.
const CLEARED_BY: Record<AddressField, AddressField[]> = {
  country: ["province", "district", "municipality", "ward", "tole"],
  province: ["district", "municipality", "ward"],
  district: ["municipality", "ward"],
  municipality: ["ward"],
  ward: [],
  tole: [],
};

export function applyAddressChange(parts: AddressParts, field: AddressField, value: string): AddressParts {
  if (parts[field] === value) return parts;
  const next: AddressParts = { ...parts, [field]: value };
  for (const child of CLEARED_BY[field]) next[child] = "";
  return next;
}

/** "Tole, Ward 5, Kathmandu Metropolitan City, Kathmandu, Bagmati, Nepal" — empty parts are skipped. */
export function formatAddress(parts: AddressParts): string {
  const ward = parts.ward.trim();
  return [
    parts.tole.trim(),
    ward ? `Ward ${ward}` : "",
    parts.municipality.trim(),
    parts.district.trim(),
    parts.province.trim(),
    parts.country.trim(),
  ]
    .filter(Boolean)
    .join(", ");
}

const UNIT_SUFFIXES = /\s+(Sub-Metropolitan City|Metropolitan City|Rural Municipality|Municipality|Gaunpalika|Nagarpalika)$/i;

/** "Kathmandu Metropolitan City" -> "Kathmandu"; "Badhaiyatal Rural Municipality" -> "Badhaiyatal". */
export function cityFromMunicipality(municipality: string): string {
  return municipality.trim().replace(UNIT_SUFFIXES, "");
}

/**
 * City follows the municipality the counselor picks, but never overwrites a City someone typed:
 * it is only replaced when empty, or when it is still the value we filled in for the previous municipality.
 */
export function nextCity(currentCity: string, previousMunicipality: string, nextMunicipality: string): string {
  if (!nextMunicipality) return currentCity;
  const wasAutoFilled = currentCity.trim() === "" || currentCity.trim() === cityFromMunicipality(previousMunicipality);
  return wasAutoFilled ? cityFromMunicipality(nextMunicipality) : currentCity;
}

export interface AddressState {
  parts: AddressParts;
  fullAddress: string;
}

/**
 * One edit to the address. Keeps `fullAddress` consistent:
 *  - Nepal with at least one part picked: rebuilt from the parts.
 *  - Changing country: the old composed address is dropped (it would describe the wrong country),
 *    but a hand-typed address is kept.
 *  - Anything else (non-Nepal, or Nepal with nothing picked yet): left as typed.
 */
export function updateAddress(state: AddressState, field: AddressField, value: string): AddressState {
  const parts = applyAddressChange(state.parts, field, value);
  if (parts === state.parts) return state;

  const hadComposed = state.fullAddress.trim() !== "" && state.fullAddress === formatAddress(state.parts);

  if (field === "country") {
    return { parts, fullAddress: hadComposed ? "" : state.fullAddress };
  }
  if (isNepal(parts.country) && Object.entries(parts).some(([k, v]) => k !== "country" && v.trim() !== "")) {
    return { parts, fullAddress: formatAddress(parts) };
  }
  return { parts, fullAddress: hadComposed ? "" : state.fullAddress };
}

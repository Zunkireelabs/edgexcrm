import { COUNTRY_CODES } from "@/lib/country-codes";

// Option lists for the lead's Residence Country and Preferred Contact. Shared by the inline Details
// box (other industries) and the education Student Details pop-up, so the two can't offer different
// choices for the same column.
export const RESIDENCE_COUNTRIES = [
  "Nepal", "India", "United States", "United Kingdom", "Canada", "Australia",
  "Germany", "France", "Japan", "China", "Singapore", "UAE", "Other",
] as const;

export const CONTACT_METHODS = [
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "any", label: "Any" },
] as const;

// Nationality dropdown: every country the phone-code picker knows (Nepal and India first, as there).
// Stored as the plain country name, same as the free text it replaces.
export const NATIONALITY_OPTIONS: readonly { value: string; label: string }[] = [
  ...new Set(COUNTRY_CODES.map((c) => c.label)),
].map((name) => ({ value: name, label: name }));

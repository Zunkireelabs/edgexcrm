export const DESTINATIONS = [
  "UK",
  "Australia",
  "USA",
  "Germany",
  "New Zealand",
  "Canada",
  "Finland",
  "India",
  "Europe",
  "Malta",
  "France",
  "Sweden",
  "Not decided",
] as const;

export const FIELDS_OF_STUDY = [
  "Engineering & Technology",
  "Business & Management",
  "Medical & Pharmacy",
  "Allied Health Sciences",
  "Humanities & Social Sciences",
  "Not decided",
] as const;

export const DEGREE_LEVELS = ["UG", "PG", "PhD"] as const;

export const INTAKE_SOURCES = [
  { value: "manual_entry", label: "Manual Entry" },
  { value: "phone_call", label: "Phone Call" },
  { value: "walk_in", label: "Walk-in" },
  { value: "referral", label: "Referral" },
  { value: "trade_show", label: "Trade Show / Event" },
  { value: "social_media", label: "Social Media" },
  { value: "email", label: "Email Inquiry" },
  { value: "other", label: "Other" },
] as const;

// Customer-facing "Where did you hear about us?" options for the walk-in
// check-in flow. Values map to leads.intake_source (free text); the "referral"
// option additionally captures a referrer name into leads.intake_campaign.
export const HEARD_ABOUT_US = [
  { value: "referral", label: "Referral" },
  { value: "social_media", label: "Social Media" },
  { value: "google", label: "Google / Online Search" },
  { value: "trade_show", label: "Education Fair / Event" },
  { value: "website", label: "Website" },
  { value: "newspaper", label: "Newspaper / Advertisement" },
  { value: "other", label: "Other" },
] as const;

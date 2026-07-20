// Custom-field keys that have their own dedicated UI or have been promoted to
// first-class columns (migration 087). Must NOT leak into the generic
// "Additional Details" renderer — they would either duplicate the dedicated UI
// or render stale pre-backfill values.
const PROMOTED_KEYS = new Set([
  "nationality",
  "source_category",
  "source_channel",
  "source_page",
  "program_level",
  "program_category",
  "interested_country",
  "campaign",
  // form-submission keys — have dedicated UI in the (universal) Lead Source panel
  "source",
  "ref_code",
  // NOTE: "hear_about" deliberately NOT reserved — no dedicated panel exists
  // for it, so it must stay in the generic Additional Info list to remain
  // visible at all.
]);

// Keys whose only dedicated UI is StudyInterestPanel, which is
// education_consultancy-only (see key-info-section.tsx). Reserving these for
// every industry would hide the data with nowhere else to show it, so they're
// only reserved when the lead actually belongs to that industry.
const EDUCATION_ONLY_PROMOTED_KEYS = new Set(["field_of_study", "education_level", "countries"]);

// Keys whose only dedicated UI is the real_estate InvestorProfileCard (see
// src/industries/real-estate/features/investors). Reserved only for real_estate
// tenants so they don't leak into the generic "Additional Details" list where a
// dedicated editor already shows them; for every other industry these are
// ordinary custom fields (no behavior change).
const REAL_ESTATE_ONLY_PROMOTED_KEYS = new Set([
  "investor_type",
  "accreditation_status",
  "kyc_status",
  "entity_name",
  "target_check_size",
  "preferred_asset_class",
]);

export function isReservedCustomField(key: string, industryId?: string | null): boolean {
  if (key === "itinerary" || key.startsWith("trip_") || PROMOTED_KEYS.has(key)) return true;
  if (industryId === "education_consultancy" && EDUCATION_ONLY_PROMOTED_KEYS.has(key)) return true;
  return industryId === "real_estate" && REAL_ESTATE_ONLY_PROMOTED_KEYS.has(key);
}

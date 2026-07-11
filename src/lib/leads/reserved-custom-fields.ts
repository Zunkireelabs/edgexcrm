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

export function isReservedCustomField(key: string, industryId?: string | null): boolean {
  if (key === "itinerary" || key.startsWith("trip_") || PROMOTED_KEYS.has(key)) return true;
  return industryId === "education_consultancy" && EDUCATION_ONLY_PROMOTED_KEYS.has(key);
}

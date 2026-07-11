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
  // form-submission keys — have dedicated UI in Lead Source / Study Interest panels
  "source",
  "ref_code",
  "field_of_study",
  "education_level",
  "countries",
  // NOTE: "hear_about" deliberately NOT reserved — no dedicated panel exists
  // for it, so it must stay in the generic Additional Info list to remain
  // visible at all.
]);

export function isReservedCustomField(key: string): boolean {
  return key === "itinerary" || key.startsWith("trip_") || PROMOTED_KEYS.has(key);
}

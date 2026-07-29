// education_consultancy forms have used 9 different custom_fields keys over time for the
// same "preferred study destination" question — see docs/DESTINATION-COLUMN-DISPLAY-FIX-BRIEF.md.
// The real `leads.destinations` column is what the UI reads; these keys are only ever
// present in custom_fields, so any submission using one of them shows a blank Destination
// column unless normalized here at write time.
export const DESTINATION_SYNONYM_KEYS = [
  "interested_country",
  "countries",
  "study_destination",
  "dream_destination",
  "preferred_study_destination",
  "country",
  "preferred_destination",
  "matched_destination",
  "select_your_preferred_destination",
] as const;

// Aliases for values seen across old form option sets (casing, full names, flag emoji).
// Extra real countries (Dubai/UAE etc.) aren't in the curated DESTINATIONS dropdown but are
// still stored as-is — never drop a value just because it's outside the curated taxonomy.
const ALIASES: Record<string, string> = {
  uk: "UK",
  "united kingdom": "UK",
  usa: "USA",
  "united states": "USA",
  "united states of america": "USA",
  "u.s.a": "USA",
  australia: "Australia",
  germany: "Germany",
  "new zealand": "New Zealand",
  new_zealand: "New Zealand",
  canada: "Canada",
  finland: "Finland",
  india: "India",
  nepal: "Nepal",
  europe: "Europe",
  malta: "Malta",
  france: "France",
  sweden: "Sweden",
  dubai: "UAE",
  uae: "UAE",
};

function stripDecoration(raw: string): string {
  return raw.replace(/^[\p{Extended_Pictographic}️\s]+/gu, "").trim();
}

function canonicalize(raw: string): string | null {
  const cleaned = stripDecoration(raw);
  if (!cleaned) return null;
  return ALIASES[cleaned.toLowerCase()] ?? cleaned;
}

export function extractDestinationsFromCustomFields(
  customFields: Record<string, unknown> | null | undefined
): string[] {
  if (!customFields) return [];
  const found = new Set<string>();
  for (const key of DESTINATION_SYNONYM_KEYS) {
    const raw = customFields[key];
    const rawValues = Array.isArray(raw)
      ? raw.filter((v): v is string => typeof v === "string")
      : typeof raw === "string"
        ? raw.split(/[,|/\n\t]+/)
        : [];
    for (const value of rawValues) {
      const canonical = canonicalize(value);
      if (canonical) found.add(canonical);
    }
  }
  return [...found];
}

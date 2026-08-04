// education_consultancy forms have used 9 different custom_fields keys over time for the
// same "preferred study destination" question — see docs/DESTINATION-COLUMN-DISPLAY-FIX-BRIEF.md.
// The real `leads.destinations` column is what the UI reads; these keys are only ever
// present in custom_fields, so any submission using one of them shows a blank Destination
// column unless normalized here at write time.
//
// This module also normalizes field_of_study/degree_level — same class of problem (a form's
// admin-typed option value can carry a flag emoji or off-canon casing/wording), just without
// destinations' history of 9 different key names, so only one canonical + one known legacy key
// is handled for each rather than a full synonym list.
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

// Strips leading emoji/pictographic decoration (flags, etc.) some forms' admin-typed
// option values carry — e.g. "🇺🇸 USA" -> "USA". Exported for direct use in tests;
// consumers reach it indirectly through the normalizeX()/canonicalizeDestination()
// wrappers below, which apply it plus aliasing/canonicalization.
//
// \p{Regional_Indicator} is required, not just \p{Extended_Pictographic}: a national flag
// emoji (🇺🇸, 🇬🇧, ...) is a pair of Regional Indicator Symbol codepoints (U+1F1E6-U+1F1FF),
// a distinct Unicode category — Extended_Pictographic alone does NOT match them. Verified:
// this function has been live since 2026-07-29 (PR #311) and never actually stripped a real
// flag, only single-codepoint pictographic emoji (e.g. 🎓) — the exact thing it was built for
// silently didn't work.
export function stripDecoration(raw: string): string {
  return raw.replace(/^[\p{Regional_Indicator}\p{Extended_Pictographic}️\s]+/gu, "").trim();
}

function canonicalizeDestination(raw: string): string | null {
  const cleaned = stripDecoration(raw);
  if (!cleaned) return null;
  return ALIASES[cleaned.toLowerCase()] ?? cleaned;
}

// Applies the same cleanup an explicitly-posted `destinations` array skipped before this
// fix — canonicalize() was previously only reachable via the custom_fields synonym-key
// fallback, so a form using the real `destinations` key directly got zero normalization.
export function normalizeDestinations(raw: string[]): string[] {
  const found = new Set<string>();
  for (const value of raw) {
    const canonical = canonicalizeDestination(value);
    if (canonical) found.add(canonical);
  }
  return [...found];
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
      const canonical = canonicalizeDestination(value);
      if (canonical) found.add(canonical);
    }
  }
  return [...found];
}

// One known legacy custom_fields key per field (the key key-info-section.tsx's display-time
// fallback already scans) — unlike destinations, there's no evidence of a wider synonym
// sprawl for these two, so this stays a single fallback key rather than an invented list.
const FIELD_OF_STUDY_SYNONYM_KEYS = ["field_of_study"] as const;
const DEGREE_LEVEL_SYNONYM_KEYS = ["degree_level", "education_level"] as const;

export function normalizeFieldOfStudy(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return stripDecoration(raw) || null;
}

const DEGREE_LEVEL_ALIASES: Record<string, string> = {
  ug: "Undergraduate",
  undergraduate: "Undergraduate",
  bachelor: "Undergraduate",
  bachelors: "Undergraduate",
  "bachelor's": "Undergraduate",
  pg: "Postgraduate",
  postgraduate: "Postgraduate",
  master: "Postgraduate",
  masters: "Postgraduate",
  "master's": "Postgraduate",
  phd: "Doctor of Philosophy (PhD)",
  "ph.d": "Doctor of Philosophy (PhD)",
  "ph.d.": "Doctor of Philosophy (PhD)",
  doctorate: "Doctor of Philosophy (PhD)",
  "doctor of philosophy": "Doctor of Philosophy (PhD)",
};

export function normalizeDegreeLevel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = stripDecoration(raw);
  if (!cleaned) return null;
  return DEGREE_LEVEL_ALIASES[cleaned.toLowerCase()] ?? cleaned;
}

// Extracts a single value from custom_fields for a single-value (non-array) field, trying
// the canonical key first, then the field's one known legacy key. Used for field_of_study
// and degree_level — both single-select, unlike destinations' multi-value array.
function extractSingleFromCustomFields(
  customFields: Record<string, unknown> | null | undefined,
  keys: readonly string[]
): string | null {
  if (!customFields) return null;
  for (const key of keys) {
    const raw = customFields[key];
    if (typeof raw === "string" && raw.trim()) return raw;
  }
  return null;
}

export function resolveFieldOfStudy(
  explicit: string | null | undefined,
  customFields: Record<string, unknown> | null | undefined
): string | null {
  const raw = explicit || extractSingleFromCustomFields(customFields, FIELD_OF_STUDY_SYNONYM_KEYS);
  return normalizeFieldOfStudy(raw);
}

export function resolveDegreeLevel(
  explicit: string | null | undefined,
  customFields: Record<string, unknown> | null | undefined
): string | null {
  const raw = explicit || extractSingleFromCustomFields(customFields, DEGREE_LEVEL_SYNONYM_KEYS);
  return normalizeDegreeLevel(raw);
}

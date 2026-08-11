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

// Strips leading emoji/pictographic decoration (flags, etc.) some forms' admin-typed
// option values carry — e.g. "🇺🇸 USA" -> "USA". Exported for direct use in tests;
// consumers reach it indirectly through the normalizeX() wrappers below.
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

// Deliberately NOT rewritten to a hardcoded "canonical" spelling (e.g. "united states" ->
// "USA"). Destinations/degree levels are each tenant's OWN configurable catalog (Settings ->
// Destination Countries / Study Levels — the `countries`/`study_levels` tables), and different
// tenants spell the same option differently (one tenant's real catalog says "United States",
// not "USA"). A prior version of this function rewrote to a hardcoded abbreviation and it
// silently broke: a lead already correctly holding "United Kingdom" (matching that tenant's
// real catalog) got rewritten to "UK" mid-normalization, which then matched NO checkbox in
// that tenant's actual options list — an already-fine value became an invisible orphan.
// Cleanup here is intentionally limited to what's safe for ANY tenant's spelling: strip
// decoration, and nothing else. Case/whitespace-only duplicates still merge (see the Map-based
// dedup below), keeping whichever spelling was seen first — never inventing a new one.
function cleanValue(raw: string): string | null {
  return stripDecoration(raw) || null;
}

// Dedupes case/whitespace-insensitively while preserving the first-seen spelling — so
// ["USA", "usa"] collapses to one entry using whichever spelling appeared first, but never
// substitutes a different spelling than what was actually present.
function dedupePreservingFirstSpelling(values: string[]): string[] {
  const seen = new Map<string, string>(); // lowercased key -> first-seen original spelling
  for (const raw of values) {
    const cleaned = cleanValue(raw);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (!seen.has(key)) seen.set(key, cleaned);
  }
  return [...seen.values()];
}

// Applies the same cleanup an explicitly-posted `destinations` array skipped before this
// fix — this was previously only reachable via the custom_fields synonym-key fallback, so a
// form using the real `destinations` key directly got zero normalization.
export function normalizeDestinations(raw: string[]): string[] {
  return dedupePreservingFirstSpelling(raw);
}

export function extractDestinationsFromCustomFields(
  customFields: Record<string, unknown> | null | undefined
): string[] {
  if (!customFields) return [];
  const collected: string[] = [];
  for (const key of DESTINATION_SYNONYM_KEYS) {
    const raw = customFields[key];
    const rawValues = Array.isArray(raw)
      ? raw.filter((v): v is string => typeof v === "string")
      : typeof raw === "string"
        ? raw.split(/[,|/\n\t]+/)
        : [];
    collected.push(...rawValues);
  }
  return dedupePreservingFirstSpelling(collected);
}

// One known legacy custom_fields key per field (the key key-info-section.tsx's display-time
// fallback already scans) — unlike destinations, there's no evidence of a wider synonym
// sprawl for these two, so this stays a single fallback key rather than an invented list.
const FIELD_OF_STUDY_SYNONYM_KEYS = ["field_of_study"] as const;
const DEGREE_LEVEL_SYNONYM_KEYS = ["degree_level", "education_level"] as const;

export function normalizeFieldOfStudy(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return cleanValue(raw);
}

// Same "never rewrite to a hardcoded spelling" rule as destinations — degree_level is also a
// tenant-configurable catalog (`study_levels` table), so a fixed alias map (e.g. "UG" ->
// "Undergraduate") carries the identical risk of drifting from what a given tenant actually
// configured. Strip decoration only; leave the wording exactly as given.
export function normalizeDegreeLevel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return cleanValue(raw);
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

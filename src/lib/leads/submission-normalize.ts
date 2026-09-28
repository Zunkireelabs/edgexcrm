// External integrations posting to the public submit API don't always use our exact
// contract: a website's own contact-form JS may name a field something else entirely
// (e.g. "work_email" instead of "email") and may post extra questions as loose
// top-level keys instead of nesting them under `custom_fields`. Previously that meant
// silent data loss — the mismatched key was neither recognized as the canonical field
// nor captured anywhere as custom data. See docs/CHAYCE-PROPERTIES-FORM-INTEGRATION.md-
// adjacent incident: zunkireelabs.com's own contact form sent `work_email` + several
// unnested extra questions, and none of it survived past this route.
//
// Two independent fixes:
//   1. resolveEmail() — try a short, known list of synonym keys before giving up.
//   2. foldUnknownFieldsIntoCustomFields() — anything that isn't a recognized standard
//      key gets folded into custom_fields automatically, so a caller's contract
//      mismatch degrades to "shows up as a custom field" instead of "vanishes".
export const EMAIL_SYNONYM_KEYS = [
  "work_email",
  "email_address",
  "contact_email",
  "business_email",
] as const;

export function resolveEmail(body: Record<string, unknown>): string | null {
  if (typeof body.email === "string" && body.email.trim()) return body.email;
  const customFields = (body.custom_fields && typeof body.custom_fields === "object")
    ? (body.custom_fields as Record<string, unknown>)
    : {};
  for (const key of EMAIL_SYNONYM_KEYS) {
    const raw = body[key] ?? customFields[key];
    if (typeof raw === "string" && raw.trim()) return raw;
  }
  return null;
}

// Every top-level key the public submit route already reads explicitly. Kept as a flat
// list (not derived from destructuring) so it stays correct even if the route's
// destructuring order changes.
const KNOWN_SUBMISSION_KEYS = [
  "idempotency_key",
  "first_name",
  "last_name",
  "email",
  "phone",
  "city",
  "country",
  "destinations",
  "field_of_study",
  "degree_level",
  "custom_fields",
  "file_urls",
  "entity_id",
  "intake_source",
  "intake_medium",
  "intake_campaign",
  "intake_account",
  "preferred_contact_method",
  "tags",
] as const;

export function foldUnknownFieldsIntoCustomFields(
  body: Record<string, unknown>,
  extraKnownKeys: readonly string[] = []
): Record<string, unknown> {
  const known = new Set<string>([...KNOWN_SUBMISSION_KEYS, ...extraKnownKeys]);
  const result: Record<string, unknown> = (body.custom_fields && typeof body.custom_fields === "object")
    ? { ...(body.custom_fields as Record<string, unknown>) }
    : {};
  for (const [key, value] of Object.entries(body)) {
    if (known.has(key)) continue;
    if (!(key in result)) result[key] = value;
  }
  return result;
}

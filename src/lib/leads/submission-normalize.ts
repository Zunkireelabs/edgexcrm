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

export interface ResolvedEmail {
  value: string | null;
  // Which top-level key the value came from ("email" or one of EMAIL_SYNONYM_KEYS), or
  // null if nothing matched. Callers use this to exclude ONLY that specific key from
  // custom_fields — not the whole synonym list — so a submission that legitimately sends
  // both `email` and a distinct `business_email` (two different addresses, not the same
  // field under two names) doesn't lose the second one: it stays visible in custom_fields
  // instead of being excluded (because it's a "known" synonym key) yet never promoted
  // anywhere (because `email` already won).
  sourceKey: string | null;
}

export function resolveEmailField(body: Record<string, unknown>): ResolvedEmail {
  if (typeof body.email === "string" && body.email.trim()) return { value: body.email, sourceKey: "email" };
  const customFields = (body.custom_fields && typeof body.custom_fields === "object")
    ? (body.custom_fields as Record<string, unknown>)
    : {};
  for (const key of EMAIL_SYNONYM_KEYS) {
    const raw = body[key] ?? customFields[key];
    if (typeof raw === "string" && raw.trim()) return { value: raw, sourceKey: key };
  }
  return { value: null, sourceKey: null };
}

export function resolveEmail(body: Record<string, unknown>): string | null {
  return resolveEmailField(body).value;
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

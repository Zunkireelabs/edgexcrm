// Lead tag normalisation (EDGEX-127). Leads store tags as lowercase-kebab strings (e.g. "visa-admission-granted",
// "student"). The bulk "Add tag" picker and PATCH /api/v1/leads/bulk both go through this so a tag typed as
// "Visa Admission Granted" is stored (and de-duplicated) as "visa-admission-granted".

export const MAX_TAG_LEN = 50;
export const MAX_ADD_TAGS = 10;

export function normaliseLeadTag(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** existing tags + the new ones, no duplicates (case-insensitive), existing order kept. */
export function unionTags(existing: readonly string[] | null | undefined, add: readonly string[]): string[] {
  const out = [...(existing ?? [])];
  const seen = new Set(out.map((t) => t.toLowerCase()));
  for (const t of add) {
    if (!seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  }
  return out;
}

export type AddTagsResult = { ok: true; tags: string[] } | { ok: false; error: string };

/** Validate + normalise a request's add_tags: non-empty array, <= MAX_ADD_TAGS, each non-empty and <= MAX_TAG_LEN. */
export function parseAddTags(input: unknown): AddTagsResult {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, error: "add_tags must be a non-empty array of strings" };
  if (input.length > MAX_ADD_TAGS) return { ok: false, error: `Cannot add more than ${MAX_ADD_TAGS} tags at once` };
  const tags: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") return { ok: false, error: "add_tags must be an array of strings" };
    const t = normaliseLeadTag(raw);
    if (!t) return { ok: false, error: "Tags cannot be empty" };
    if (t.length > MAX_TAG_LEN) return { ok: false, error: `Tags must be ${MAX_TAG_LEN} characters or fewer` };
    if (!tags.includes(t)) tags.push(t);
  }
  return { ok: true, tags };
}

/** Distinct tags with lead counts from rows of `tags` arrays (case-insensitive key, first spelling kept), biggest first. */
export function countTags(rows: ReadonlyArray<{ tags: string[] | null }>): Array<{ tag: string; count: number }> {
  const byKey = new Map<string, { tag: string; count: number }>();
  for (const r of rows) {
    const seen = new Set<string>();
    for (const t of r.tags ?? []) {
      const key = t.toLowerCase();
      if (!t || seen.has(key)) continue;
      seen.add(key);
      const e = byKey.get(key);
      if (e) e.count += 1;
      else byKey.set(key, { tag: t, count: 1 });
    }
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

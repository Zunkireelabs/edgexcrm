// Pure, dependency-free helpers for deriving "every distinct answer this lead
// has ever given" for a custom_fields key across repeat form submissions.
// Deliberately has zero imports so it's safe to use from both server and
// client components (unlike dedup.ts, which pulls in server-only clients).

export interface LeadSubmissionSnapshot {
  custom_fields: Record<string, unknown> | null;
}

// Collects every distinct, non-empty string value ever recorded for `key`,
// oldest first. When the lead has real submission history (came through the
// public-submit path), that history is authoritative — it's an accurate
// per-event snapshot, unlike the canonical lead row which only ever reflects
// the first value it saw for a given key. When there's no history at all
// (manually-created leads, imports, or leads seeded directly), falls back to
// the lead's current custom_fields value so existing single-value leads keep
// working exactly as before.
export function getDistinctFormValues(
  currentCustomFields: Record<string, unknown> | null | undefined,
  submissionHistory: LeadSubmissionSnapshot[] | null | undefined,
  key: string
): string[] {
  const history = submissionHistory ?? [];
  const seen = new Set<string>();
  const values: string[] = [];

  const push = (raw: unknown) => {
    if (typeof raw !== "string") return;
    const v = raw.trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    values.push(v);
  };

  if (history.length > 0) {
    for (const snapshot of history) push(snapshot.custom_fields?.[key]);
  } else {
    push((currentCustomFields ?? {})[key]);
  }

  return values;
}

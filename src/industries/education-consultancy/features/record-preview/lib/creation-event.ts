import type { PreviewActivity } from "../use-preview-data";

/**
 * A lead's creation is always an event (Attio: "Attio system created Person"). In the preview it reads
 * "{actor} created the lead" whether it came from the audit log or is synthesized from leads.created_at.
 * Never two of them: an audit creation row wins over a synthetic one.
 */
export const CREATION_VERB = "created the lead";

/** An audit row that records the lead's creation (a first submission, a manual create, or a plain create). */
export function isCreationAudit(
  kind: string,
  changes: Record<string, { old: unknown; new: unknown }> | null | undefined,
): boolean {
  if (kind === "created") return true;
  return kind === "submission" && changes?.is_first?.new === true;
}

export function ensureCreationEvent(
  feed: PreviewActivity[],
  opts: { createdAt: string; sourceLabel: string | null },
): PreviewActivity[] {
  const real = feed.filter((e) => e.kind === "created");
  const others = feed.filter((e) => e.kind !== "created");
  // Prefer the audit row that has a person on it, else the first one; drop the rest.
  const keep = real.find((e) => e.actor_id) ?? real[0] ?? {
    id: "created-synthetic",
    at: opts.createdAt,
    actor_id: null,
    actor_name: null,
    source: opts.sourceLabel?.trim() || "Imported",
    kind: "created",
    verb: CREATION_VERB,
    object: null,
    snippet: null,
  };
  return [...others, { ...keep, verb: CREATION_VERB, object: null }];
}

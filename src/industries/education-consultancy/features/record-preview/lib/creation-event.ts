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

/** What the creation entry says beyond "created the lead": how it was made and where it came from. */
export interface CreationDetail {
  how?: string | null;
  source?: string | null;
  channel?: string | null;
  campaign?: string | null;
}

/** How a lead was created, from its creation audit row's changes: "manually", "via the <form> form", "via the API"… */
export function creationHow(changes: Record<string, { old: unknown; new: unknown }> | null | undefined): string | null {
  const via = changes?.created_via?.new;
  const form = changes?.form_name?.new;
  if (via === "manual") return "manually";
  if (typeof form === "string" && form.trim()) return `via the ${form.trim()} form`;
  if (via === "public_form") return "via a form";
  if (via === "public_api") return "via the API";
  if (via === "integration") return "via an integration";
  return null;
}

/** "via the X form · Source: Facebook · Channel: Paid · Campaign: UK" (each part only when known). null when nothing is known. */
export function creationDetailText(d: CreationDetail | undefined, includeSource: boolean): string | null {
  if (!d) return null;
  const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  const rest = [
    includeSource && clean(d.source) ? `Source: ${clean(d.source)}` : null,
    clean(d.channel) ? `Channel: ${clean(d.channel)}` : null,
    clean(d.campaign) ? `Campaign: ${clean(d.campaign)}` : null,
  ].filter(Boolean).join(" · ");
  const how = clean(d.how);
  if (!how && !rest) return null;
  return (how ?? "") + (rest ? (how ? " · " : "· ") + rest : "");
}

export function ensureCreationEvent(
  feed: PreviewActivity[],
  opts: { createdAt: string; sourceLabel: string | null; detail?: CreationDetail },
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
  // A made-up entry already names the source as its actor, so the detail line leaves it out there.
  const synthetic = keep.id === "created-synthetic";
  return [...others, { ...keep, verb: CREATION_VERB, object: creationDetailText(opts.detail, !synthetic) }];
}

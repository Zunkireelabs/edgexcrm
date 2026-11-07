import { OTHER_TAG_VALUES } from "@/lib/leads/lead-type";

/**
 * ONE definition of "a lead someone should be working", shared by every Home rule / loader and smart assignment's Room count.
 * A lead is workable when it is
 *   - not deleted, not archived (`archived_at`), not on hold,
 *   - in an active list (non-archive, non-staging),
 *   - not a walk-in contact (tagged with any of OTHER_TAG_VALUES; the leads list hides these too), and
 *   - not in a terminal status for ITS pipeline (`pipeline_stages.is_terminal` for the lead's pipeline_id + status slug).
 * A re-opened lead (terminal -> open status) counts again, because the status is read live.
 * Not applied to: stale call-back clean-up, Pulse, the impact SQL, application-based rules, the leads list.
 */

export interface StageRow {
  pipeline_id: string | null;
  slug: string;
  is_terminal: boolean;
}

export interface WorkablePlan {
  activeListIds: string[];
  /** Slugs that are terminal in EVERY pipeline that has them: a plain `status not in (...)`. */
  terminalEverywhere: string[];
  /** Slugs terminal in some pipelines and open in others: terminal only for the listed pipelines (null = no pipeline). */
  terminalSome: Array<{ slug: string; pipelineIds: Array<string | null> }>;
}

export function buildWorkablePlan(activeListIds: string[], stages: StageRow[]): WorkablePlan {
  const bySlug = new Map<string, { terminal: Set<string | null>; open: Set<string | null> }>();
  for (const s of stages) {
    const e = bySlug.get(s.slug) ?? { terminal: new Set<string | null>(), open: new Set<string | null>() };
    (s.is_terminal ? e.terminal : e.open).add(s.pipeline_id);
    bySlug.set(s.slug, e);
  }
  const terminalEverywhere: string[] = [];
  const terminalSome: WorkablePlan["terminalSome"] = [];
  for (const [slug, e] of [...bySlug].sort(([a], [b]) => a.localeCompare(b))) {
    if (e.terminal.size === 0) continue;
    if (e.open.size === 0) terminalEverywhere.push(slug);
    else terminalSome.push({ slug, pipelineIds: [...e.terminal] });
  }
  return { activeListIds, terminalEverywhere, terminalSome };
}

export interface WorkableLead {
  deleted_at?: string | null;
  archived_at?: string | null;
  on_hold?: boolean | null;
  list_id: string | null;
  tags?: string[] | null;
  status?: string | null;
  pipeline_id?: string | null;
}

export function isTerminalStatus(status: string | null, pipelineId: string | null, plan: WorkablePlan): boolean {
  if (!status) return false;
  if (plan.terminalEverywhere.includes(status)) return true;
  return plan.terminalSome.some((t) => t.slug === status && t.pipelineIds.includes(pipelineId));
}

/** The same definition in JS, for leads already in memory (a counsellor's own leads). A lead with no list counts as active, as before. */
export function isWorkable(lead: WorkableLead, plan: WorkablePlan): boolean {
  if (lead.deleted_at || lead.archived_at || lead.on_hold) return false;
  if (lead.list_id !== null && !plan.activeListIds.includes(lead.list_id)) return false;
  if ((lead.tags ?? []).some((t) => (OTHER_TAG_VALUES as readonly string[]).includes(t))) return false;
  return !isTerminalStatus(lead.status ?? null, lead.pipeline_id ?? null, plan);
}

/** The minimal PostgREST builder surface the helper needs. */
interface FilterChain {
  is(column: string, value: null): unknown;
  or(filters: string): unknown;
  in(column: string, values: string[]): unknown;
}

const quote = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const NO_LIST = "00000000-0000-0000-0000-000000000000";

/**
 * Apply the definition to a PostgREST builder, so counts (`head: true`, `count: "exact"`) stay exact: nothing is filtered after
 * the fetch. No active list yields an impossible filter (no rows), never "all lists". NULL status / tags / on_hold stay workable.
 */
export function applyWorkable<T>(query: T, plan: WorkablePlan): T {
  let b = query as unknown as FilterChain;
  const step = (next: unknown) => {
    b = next as FilterChain;
  };
  step(b.is("deleted_at", null));
  step(b.is("archived_at", null));
  step(b.or("on_hold.is.null,on_hold.eq.false"));
  step(b.in("list_id", plan.activeListIds.length ? plan.activeListIds : [NO_LIST]));
  step(b.or(`tags.is.null,tags.not.ov.{${OTHER_TAG_VALUES.join(",")}}`));
  if (plan.terminalEverywhere.length) step(b.or(`status.is.null,status.not.in.(${plan.terminalEverywhere.map(quote).join(",")})`));
  for (const t of plan.terminalSome) {
    const ids = t.pipelineIds.filter((p): p is string => p !== null);
    const hasNull = t.pipelineIds.includes(null);
    // Not terminal = another status, OR a pipeline where this slug is still open.
    const open = hasNull
      ? ids.length
        ? `and(pipeline_id.not.is.null,pipeline_id.not.in.(${ids.join(",")}))`
        : "pipeline_id.not.is.null"
      : `pipeline_id.is.null,pipeline_id.not.in.(${ids.join(",")})`;
    step(b.or(`status.is.null,status.neq.${quote(t.slug)},${open}`));
  }
  return b as unknown as T;
}

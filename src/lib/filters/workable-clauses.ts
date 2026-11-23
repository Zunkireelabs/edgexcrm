import { OTHER_TAG_VALUES } from "../leads/lead-type";

/**
 * The "workable lead" conditions as PostgREST clauses, built ONCE and used by both:
 *  - `applyWorkable` (Home's counts, a query builder chain), and
 *  - the `workable` filter field (the leads list, from a Review link),
 * so a Home number and the rows its link opens cannot drift. (Imports only the walk-in tag constant, a plain value.)
 *
 * A lead is workable when it is not deleted, not archived, not on hold, not a walk-in contact (OTHER tags), and not in a
 * terminal status for ITS pipeline. "In an active list" is the one step a caller applies itself (`kind: "list"`), because the
 * list ids are a separate input (a stage condition on a link).
 */
export interface WorkableTerminal {
  /** Slugs that are terminal in EVERY pipeline that has them: a plain `status not in (...)`. */
  terminalEverywhere: string[];
  /** Slugs terminal in some pipelines and open in others: terminal only for the listed pipelines (null = no pipeline). */
  terminalSome: Array<{ slug: string; pipelineIds: Array<string | null> }>;
}

export type WorkableStep =
  | { kind: "is_null"; column: string }
  /** A comma-separated PostgREST `or` list (the argument of `.or()`). */
  | { kind: "or"; expr: string }
  /** Where the caller applies its "in an active list" condition. */
  | { kind: "list" };

const quote = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export function workableSteps(t: WorkableTerminal): WorkableStep[] {
  const steps: WorkableStep[] = [
    { kind: "is_null", column: "deleted_at" },
    { kind: "is_null", column: "archived_at" },
    { kind: "or", expr: "on_hold.is.null,on_hold.eq.false" },
    { kind: "list" },
    { kind: "or", expr: `tags.is.null,tags.not.ov.{${OTHER_TAG_VALUES.join(",")}}` },
  ];
  if (t.terminalEverywhere.length) steps.push({ kind: "or", expr: `status.is.null,status.not.in.(${t.terminalEverywhere.map(quote).join(",")})` });
  for (const x of t.terminalSome) {
    const ids = x.pipelineIds.filter((p): p is string => p !== null);
    const hasNull = x.pipelineIds.includes(null);
    // Not terminal = another status, OR a pipeline where this slug is still open.
    const open = hasNull
      ? ids.length
        ? `and(pipeline_id.not.is.null,pipeline_id.not.in.(${ids.join(",")}))`
        : "pipeline_id.not.is.null"
      : `pipeline_id.is.null,pipeline_id.not.in.(${ids.join(",")})`;
    steps.push({ kind: "or", expr: `status.is.null,status.neq.${quote(x.slug)},${open}` });
  }
  return steps;
}

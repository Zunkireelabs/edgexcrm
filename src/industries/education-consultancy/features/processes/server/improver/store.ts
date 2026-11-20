import { type ChangeRecord } from "../../lib/changes-flow";
import { changeDirection, movedSince, REJECTED_MEMORY_DAYS, type RejectedIdea } from "../../lib/improver/memory";
import type { ProposeStore } from "../../lib/improver/propose";
import type { ProcessKey } from "../../lib/keys";
import { METRIC_REGISTRY, type RawMetrics } from "../../lib/metrics";
import type { ProcessSpec } from "../../lib/spec";
import { CHANGE_COLS, dbSuggestStore, must } from "../changes";
import type { ProcessesDb } from "../context";

/** What the 60-day memory needs to tell whether the number behind a rejected idea has moved. */
export interface RejectedContext {
  processId: string;
  key: ProcessKey;
  spec: ProcessSpec | null;
  /** The 30-day numbers now. */
  rawNow: RawMetrics | null;
}

interface RejectedVersion {
  id: string;
  rejected_at: string | null;
  rejected_reason: string | null;
}
interface RejectedChange {
  version_id: string;
  part: string;
  field: ChangeRecord["field"];
  before: unknown;
  after: unknown;
}

const DAY = 86_400_000;
const dayOf = (iso: string): string => iso.slice(0, 10);

/** Drafts rejected in the last 60 days (anyone's, a person's or Orca's) and the changes they held. Plain queries, no embeds. */
export async function loadRejectedIdeas(db: ProcessesDb, ctx: RejectedContext, now: Date): Promise<RejectedIdea[]> {
  const since = new Date(now.getTime() - REJECTED_MEMORY_DAYS * DAY).toISOString();
  const versions =
    (must("rejected drafts read", await db.from("process_versions").select("id, rejected_at, rejected_reason").eq("process_id", ctx.processId).eq("status", "rejected").gte("rejected_at", since)) as unknown as RejectedVersion[] | null) ?? [];
  if (versions.length === 0) return [];
  const changes =
    (must("rejected changes read", await db.from("process_changes").select("version_id, part, field, before, after").in("version_id", versions.map((v) => v.id))) as unknown as RejectedChange[] | null) ?? [];

  const snapshotCache = new Map<string, RawMetrics | null>();
  const snapshotAt = async (day: string): Promise<RawMetrics | null> => {
    if (snapshotCache.has(day)) return snapshotCache.get(day) ?? null;
    const rows = must("snapshot read", await db.from("process_metric_snapshots").select("metrics").eq("process_id", ctx.processId).lte("day", day).order("day", { ascending: false }).limit(1)) as unknown as Array<{ metrics: RawMetrics }> | null;
    const raw = rows?.[0]?.metrics ?? null;
    snapshotCache.set(day, raw);
    return raw;
  };

  const out: RejectedIdea[] = [];
  for (const c of changes) {
    const v = versions.find((x) => x.id === c.version_id);
    if (!v?.rejected_at) continue;
    out.push({
      part: c.part,
      field: c.field,
      direction: changeDirection(c.field, c.before, c.after),
      rejectedAt: v.rejected_at,
      reason: v.rejected_reason,
      movedSince: await stepNumberMoved(c, v.rejected_at, ctx, snapshotAt),
    });
  }
  return out;
}

/** The measure behind a step's change: its target metric (or the one the change switched from), then vs now. Parts without a measure never "move". */
async function stepNumberMoved(c: RejectedChange, rejectedAt: string, ctx: RejectedContext, snapshotAt: (day: string) => Promise<RawMetrics | null>): Promise<boolean> {
  if (!c.part.startsWith("step:") || !ctx.spec || !ctx.rawNow) return false;
  const step = ctx.spec.steps.find((s) => s.key === c.part.slice(5));
  if (!step) return false;
  const beforeMetric = (c.before as { metric?: unknown } | null)?.metric;
  const metric = typeof beforeMetric === "string" ? beforeMetric : step.target.metric;
  const def = METRIC_REGISTRY[ctx.key][metric];
  if (!def) return false;
  const then = await snapshotAt(dayOf(rejectedAt));
  if (!then) return false;
  return movedSince(def.unit, def.read(then), def.read(ctx.rawNow));
}

/** The stores one Orca proposal needs: a person's suggest store (same reads and the same draft insert) plus the agent extras. */
export function dbProposeStore(db: ProcessesDb, rejected: RejectedContext): ProposeStore {
  return {
    ...dbSuggestStore(db),
    rejectedIdeas: (_processId, now) => loadRejectedIdeas(db, rejected, now),
    async insertAgentChange(row) {
      return must("agent change insert", await db.from("process_changes").insert(row).select(CHANGE_COLS).single()) as unknown as ChangeRecord;
    },
    async deleteDraft(versionId) {
      // Only ever a draft this run just created (conditional on status), so a live or retired version can never be removed.
      const { error } = await db.from("process_versions").delete().eq("id", versionId).eq("status", "draft");
      if (error) throw new Error(`draft delete: ${error.message}`);
    },
  };
}

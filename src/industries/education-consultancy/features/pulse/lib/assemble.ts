import { mean } from "./window";
import { coveredMean, coveredUsualIndices, firstAtFor, previousCovered, type CoverageInput } from "./coverage";
import { METRIC_KEYS, ZERO_COUNTS, activityOf, type MetricCounts, type PersonBucketRow, type PersonInfo, type PersonRow, type StageSeries } from "./types";

/** bucket 0 = current, 1 = previous, 1..4 = the usual windows. A stage missing from a bucket counts as 0. */
function stageSeries(rows: PersonBucketRow[], field: "moves_by_stage" | "back_by_stage", usualCount: number, covered?: number[]): StageSeries {
  const ids = new Set<string>();
  for (const r of rows) for (const id of Object.keys(r[field] ?? {})) ids.add(id);
  const out: StageSeries = {};
  for (const id of ids) {
    const at = (b: number) => Number(rows.find((r) => r.bucket === b)?.[field]?.[id] ?? 0);
    const idx = covered ?? Array.from({ length: usualCount }, (_, i) => i);
    out[id] = { current: at(0), previous: at(1), usual: coveredMean((i) => at(i + 1), idx) ?? (covered ? 0 : mean(idx.map((i) => at(i + 1)))) };
  }
  return out;
}

function fill(c: Partial<MetricCounts> | undefined): MetricCounts {
  return { ...ZERO_COUNTS, ...(c ?? {}) };
}

/**
 * Fold the RPC's (user, bucket) rows into one PersonRow per person.
 * bucket 0 = current window, 1 = previous, 1..4 = the 4 usual windows (so "previous" is also one of them).
 */
export function assemblePeople(people: PersonInfo[], rows: PersonBucketRow[], usualCount = 4, coverage?: CoverageInput): PersonRow[] {
  const byUser = new Map<string, PersonBucketRow[]>();
  for (const r of rows) {
    const l = byUser.get(r.user_id);
    if (l) l.push(r);
    else byUser.set(r.user_id, [r]);
  }
  return people.map((p) => {
    const mine = byUser.get(p.userId) ?? [];
    const at = (b: number) => mine.find((r) => r.bucket === b);
    const cur = at(0);
    // Coverage-aware usual: average only the prior windows the person's data actually covers (never count the
    // empty windows before the data starts as zeros), and need at least 2 of them — else there is no usual.
    const firstAt = coverage ? firstAtFor(coverage.tenantFirst, p.joinedAt, p.firstActivityAt) : null;
    const covered = coverage ? coveredUsualIndices(coverage, firstAt, usualCount) : undefined;
    const hasUsual = covered ? covered.length >= 2 : true;
    const usual = { ...ZERO_COUNTS };
    if (hasUsual) {
      const idx = covered ?? Array.from({ length: usualCount }, (_, i) => i);
      for (const k of METRIC_KEYS) usual[k] = mean(idx.map((i) => fill(at(i + 1)?.counts)[k]));
    }
    return {
      ...p,
      current: fill(cur?.counts),
      previous: fill(at(1)?.counts),
      usual,
      notesNew: cur?.notes_new ?? 0,
      notesEdited: cur?.notes_edited ?? 0,
      movesByStage: cur?.moves_by_stage ?? {},
      forwardByStage: stageSeries(mine, "moves_by_stage", usualCount, hasUsual ? covered : []),
      backByStage: stageSeries(mine, "back_by_stage", usualCount, hasUsual ? covered : []),
      bulkMoves: cur?.bulk_moves ?? 0,
      trend: Array.from({ length: usualCount + 1 }, (_, i) => activityOf(fill(at(usualCount - i)?.counts))),
      flag: null,
      hasUsual,
      previousCovered: coverage ? previousCovered(coverage, firstAt) : true,
    };
  });
}

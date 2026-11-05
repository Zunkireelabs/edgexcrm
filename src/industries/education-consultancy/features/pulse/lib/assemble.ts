import { mean } from "./window";
import { METRIC_KEYS, ZERO_COUNTS, activityOf, type MetricCounts, type PersonBucketRow, type PersonInfo, type PersonRow, type StageSeries } from "./types";

/** bucket 0 = current, 1 = previous, 1..4 = the usual windows. A stage missing from a bucket counts as 0. */
function stageSeries(rows: PersonBucketRow[], field: "moves_by_stage" | "back_by_stage", usualCount: number): StageSeries {
  const ids = new Set<string>();
  for (const r of rows) for (const id of Object.keys(r[field] ?? {})) ids.add(id);
  const out: StageSeries = {};
  for (const id of ids) {
    const at = (b: number) => Number(rows.find((r) => r.bucket === b)?.[field]?.[id] ?? 0);
    out[id] = { current: at(0), previous: at(1), usual: mean(Array.from({ length: usualCount }, (_, i) => at(i + 1))) };
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
export function assemblePeople(people: PersonInfo[], rows: PersonBucketRow[], usualCount = 4): PersonRow[] {
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
    const usual = { ...ZERO_COUNTS };
    for (const k of METRIC_KEYS) {
      usual[k] = mean(Array.from({ length: usualCount }, (_, i) => fill(at(i + 1)?.counts)[k]));
    }
    return {
      ...p,
      current: fill(cur?.counts),
      previous: fill(at(1)?.counts),
      usual,
      notesNew: cur?.notes_new ?? 0,
      notesEdited: cur?.notes_edited ?? 0,
      movesByStage: cur?.moves_by_stage ?? {},
      forwardByStage: stageSeries(mine, "moves_by_stage", usualCount),
      backByStage: stageSeries(mine, "back_by_stage", usualCount),
      bulkMoves: cur?.bulk_moves ?? 0,
      trend: Array.from({ length: usualCount + 1 }, (_, i) => activityOf(fill(at(usualCount - i)?.counts))),
      flag: null,
    };
  });
}

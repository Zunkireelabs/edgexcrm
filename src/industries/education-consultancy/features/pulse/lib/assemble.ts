import { mean } from "./window";
import { METRIC_KEYS, ZERO_COUNTS, type MetricCounts, type PersonBucketRow, type PersonInfo, type PersonRow } from "./types";

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
      bulkMoves: cur?.bulk_moves ?? 0,
      flag: null,
    };
  });
}

import type { PulseContext } from "./context";
import { periodSpans, type PeriodSpan } from "../lib/window";
import type { PersonBucketRow, PulseQuality } from "../lib/types";

export interface FunnelJson {
  stages: Array<{
    list_id: string; name: string; slug: string; sort_order: number; is_archive: boolean; base: number;
    entered: number[]; forward: number[]; out: number[]; daily: Array<{ day: string; n: number }>;
  }>;
  new_leads: number[];
  new_leads_daily: Array<{ day: string; n: number }>;
  imported_excluded: number;
  quality: {
    total: number;
    holder_source: PulseQuality["holderSource"];
    destination: PulseQuality["destination"];
    origin_slug_shaped: PulseQuality["originSlugShaped"];
    origin_name_shaped: PulseQuality["originNameShaped"];
  };
}
export interface OverviewJson { people: PersonBucketRow[]; funnel: FunnelJson }

export interface Buckets {
  rows: PersonBucketRow[];
  /** Bucket numbers that hold the usual spans (most recent first). Rolling: 1..4. Today: 2..5. */
  usualBuckets: number[];
  usualFroms?: Date[];
  previousFrom?: Date;
}

type Rpc = (span: PeriodSpan) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

/**
 * Per-person bucket rows. Rolling windows (7d / 30d / custom) are ONE call: the RPC buckets equal-length windows
 * backwards from p_to. TODAY needs aligned comparison spans (yesterday by this time; the same elapsed span on the
 * previous 4 same weekdays), which are not equal-length-contiguous, so it asks the same RPC once per span and keeps
 * bucket 0 of each, renumbered: 0 = today, 1 = yesterday, 2..5 = the same weekday ×4. Each call scans only a few
 * days back from a short span.
 */
export async function loadBuckets<T>(
  ctx: PulseContext, call: Rpc, rowsOf: (d: T) => PersonBucketRow[],
): Promise<{ results: T[]; buckets: Buckets }> {
  const { window, tz } = ctx;
  const spans = periodSpans(window, tz);
  if (!spans.aligned) {
    const r = await call({ from: window.from, to: window.to });
    if (r.error) throw new Error(r.error.message);
    const d = r.data as T;
    return { results: [d], buckets: { rows: rowsOf(d), usualBuckets: [1, 2, 3, 4] } };
  }
  const all: PeriodSpan[] = [{ from: window.from, to: window.to }, spans.previous, ...spans.usual];
  const res = await Promise.all(all.map((s) => call(s)));
  const bad = res.find((r) => r.error);
  if (bad?.error) throw new Error(bad.error.message);
  const results = res.map((r) => r.data as T);
  const rows: PersonBucketRow[] = [];
  results.forEach((d, j) => { for (const r of rowsOf(d)) if (r.bucket === 0) rows.push({ ...r, bucket: j }); });
  return { results, buckets: { rows, usualBuckets: [2, 3, 4, 5], usualFroms: spans.usual.map((s) => s.from), previousFrom: spans.previous.from } };
}

/** The funnel with its per-window arrays rebuilt from the aligned spans (index 0 today, 1 yesterday, 2..5 weekdays). */
export function mergeFunnels(results: OverviewJson[]): FunnelJson {
  const base = results[0].funnel;
  if (results.length === 1) return base;
  const pick = (get: (f: FunnelJson) => number | undefined) => results.map((r) => Number(get(r.funnel) ?? 0));
  return {
    ...base,
    stages: base.stages.map((s) => {
      const of = (r: OverviewJson) => r.funnel.stages.find((x) => x.list_id === s.list_id);
      return {
        ...s,
        entered: results.map((r) => of(r)?.entered?.[0] ?? 0),
        forward: results.map((r) => of(r)?.forward?.[0] ?? 0),
        out: results.map((r) => of(r)?.out?.[0] ?? 0),
      };
    }),
    new_leads: pick((f) => f.new_leads?.[0]),
  };
}

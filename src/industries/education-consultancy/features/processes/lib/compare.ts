import { DEFAULT_MIN_DAYS, METRIC_REGISTRY, metricMinDays, type MetricUnit, type RawMetrics } from "./metrics";
import type { ProcessKey } from "./keys";
import type { ProcessSpec } from "./spec";

/**
 * Before -> after: the SAME metrics SQL over two periods. previous = the 30 days before the version went live; current = from
 * going live to now, capped at 30 days. Pure maths here; the server fetches the two raw metric objects.
 */

export const COMPARE_WINDOW_DAYS = 30;
const DAY = 86_400_000;

/** Only the new-lead process takes a window (cohort created in it). The other three are current-state counts: their "before" is a snapshot. */
export const WINDOWED_PROCESSES: readonly ProcessKey[] = ["new_lead_first_call"];

export interface ComparePeriods {
  previous: { from: Date; to: Date };
  current: { from: Date; to: Date };
  /** Whole days the version has been live (at `now`). */
  daysLive: number;
}

export function comparePeriods(approvedAt: Date, now: Date): ComparePeriods {
  const capEnd = new Date(approvedAt.getTime() + COMPARE_WINDOW_DAYS * DAY);
  return {
    previous: { from: new Date(approvedAt.getTime() - COMPARE_WINDOW_DAYS * DAY), to: approvedAt },
    current: { from: approvedAt, to: now < capEnd ? now : capEnd },
    daysLive: Math.max(0, Math.floor((now.getTime() - approvedAt.getTime()) / DAY)),
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** percent -> points; min -> % change on the old value; count -> absolute. Null when either side is unknown (or the % base is 0). */
export function changeValue(unit: MetricUnit, before: number | null, after: number | null): number | null {
  if (before === null || after === null) return null;
  if (unit === "percent") return round1(after - before);
  if (unit === "min") return before > 0 ? round1(((after - before) / before) * 100) : null;
  return after - before;
}

/** What the "Change" cell says while it waits. Matches the mockup: "after 7 days" / "needs 14 days (the step's own target)". */
export const waitText = (minDays: number): string => (minDays <= DEFAULT_MIN_DAYS ? `after ${minDays} days` : `needs ${minDays} days (the step's own target)`);

export interface Measure {
  metric: string;
  label: string;
  unit: MetricUnit;
  before: number | null;
  after: number | null;
  /** Null until `ready`. */
  change: number | null;
  ready: boolean;
  minDays: number;
  /** Empty when ready. */
  waitText: string;
}

/** Target metrics + "show" metrics of a spec, in step order, unique. */
export function specMetrics(spec: ProcessSpec | null): string[] {
  if (!spec) return [];
  const out: string[] = [];
  for (const s of spec.steps) for (const m of [s.target.metric, s.show?.metric]) if (m && !out.includes(m)) out.push(m);
  return out;
}

/** Union of the two versions' metrics: current's in step order, then any only the previous one had. */
export function measureMetrics(previous: ProcessSpec | null, current: ProcessSpec): string[] {
  const out = specMetrics(current);
  for (const m of specMetrics(previous)) if (!out.includes(m)) out.push(m);
  return out;
}

export function buildMeasures(
  key: ProcessKey,
  metrics: string[],
  rawBefore: RawMetrics | null,
  rawAfter: RawMetrics | null,
  daysLive: number,
): Measure[] {
  const out: Measure[] = [];
  for (const metric of metrics) {
    const def = METRIC_REGISTRY[key][metric];
    if (!def) continue;
    const minDays = metricMinDays(key, metric);
    const ready = daysLive >= minDays;
    const before = rawBefore ? def.read(rawBefore) : null;
    const rawNow = rawAfter ? def.read(rawAfter) : null;
    // A measure with its own longer clock (e.g. "decided within 14 days") means nothing before that clock has run: show no "after" yet.
    const after = ready || minDays <= DEFAULT_MIN_DAYS ? rawNow : null;
    out.push({
      metric,
      label: def.label,
      unit: def.unit,
      before,
      after,
      change: ready ? changeValue(def.unit, before, after) : null,
      ready,
      minDays,
      waitText: ready ? "" : waitText(minDays),
    });
  }
  return out;
}

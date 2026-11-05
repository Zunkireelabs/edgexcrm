import type { TenantConfig } from "@/types/database";

/** Rule thresholds for Pulse's signals + the bulk-move heuristic. Stored on tenants.config.pulse_thresholds. */
export interface PulseThresholds {
  /** Activity drop fires when activity <= ratio × usual … */
  activityDropRatio: number;
  /** … and usual >= this (a quiet person's "drop" is noise). */
  activityDropMinUsual: number;
  overCapacityRatio: number;
  overCapacityMin: number;
  stageLeakRatio: number;
  stageLeakMin: number;
  /** Historical bulk heuristic: >= this many stage-move rows by one actor in one bucket … */
  bulkMinRows: number;
  /** … of this many seconds. */
  bulkBucketSeconds: number;
}

export const DEFAULT_PULSE_THRESHOLDS: PulseThresholds = {
  activityDropRatio: 0.4,
  activityDropMinUsual: 10,
  overCapacityRatio: 1.8,
  overCapacityMin: 20,
  stageLeakRatio: 2,
  stageLeakMin: 10,
  bulkMinRows: 20,
  bulkBucketSeconds: 60,
};

export function resolvePulseThresholds(config: TenantConfig | null | undefined): PulseThresholds {
  const s = config?.pulse_thresholds;
  const d = DEFAULT_PULSE_THRESHOLDS;
  const num = (v: number | undefined, fallback: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback);
  return {
    activityDropRatio: num(s?.activity_drop_ratio, d.activityDropRatio),
    activityDropMinUsual: num(s?.activity_drop_min_usual, d.activityDropMinUsual),
    overCapacityRatio: num(s?.over_capacity_ratio, d.overCapacityRatio),
    overCapacityMin: num(s?.over_capacity_min, d.overCapacityMin),
    stageLeakRatio: num(s?.stage_leak_ratio, d.stageLeakRatio),
    stageLeakMin: num(s?.stage_leak_min, d.stageLeakMin),
    bulkMinRows: num(s?.bulk_min_rows, d.bulkMinRows),
    bulkBucketSeconds: num(s?.bulk_bucket_seconds, d.bulkBucketSeconds),
  };
}

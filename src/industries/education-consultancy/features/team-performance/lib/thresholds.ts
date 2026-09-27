import type { TenantConfig } from "@/types/database";

// Sane default for the Team & Lead Performance dashboard's one Phase 1 tunable
// threshold. Stored on tenants.config.team_performance_thresholds (hand-editable
// JSON, no settings UI in Phase 1) — an owner's tolerance for "too slow" differs
// by tenant, so this is config, never a hardcoded constant.
//
// Per-stage dwell thresholds (a real "stuck" definition based on days-in-stage)
// are Phase 2 — no per-lead stage-entry timestamp exists to compute dwell from
// yet (stage_changed_at is overwritten in place, no history). Don't add a
// stage_dwell_days field here until a widget actually consumes it — the
// Relay Explorer's stuck-rate today is a plain touched/pile ratio for the
// window, not dwell-based.

export const DEFAULT_INTAKE_ALARM_BUCKETS_HOURS: [number, number] = [24, 48];
export const DEFAULT_FOLLOW_UP_STALE_DAYS = 3;

export interface TeamPerformanceThresholds {
  intakeAlarmBucketsHours: [number, number];
  followUpStaleDays: number;
}

export function resolveThresholds(config: TenantConfig | null | undefined): TeamPerformanceThresholds {
  const stored = config?.team_performance_thresholds;
  return {
    intakeAlarmBucketsHours: stored?.intake_alarm_buckets_hours ?? DEFAULT_INTAKE_ALARM_BUCKETS_HOURS,
    followUpStaleDays: stored?.follow_up_stale_days ?? DEFAULT_FOLLOW_UP_STALE_DAYS,
  };
}

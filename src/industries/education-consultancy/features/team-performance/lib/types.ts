// Row shape returned by education_relay_aggregates (migration 241) — consumed
// by both edu-team-relay (explorer) and edu-branch-breakdown, pivoted differently.
export interface RelayAggregateRow {
  stage_slug: string;
  stage_name: string;
  position_slug: string | null;
  position_name: string | null;
  user_id: string | null;
  user_email: string | null;
  branch_id: string | null;
  branch_name: string | null;
  cnt: number;
  touched_cnt: number;
  enrolled_cnt: number;
  tuition_value: number;
}

export interface LeakageFunnelRow {
  stage_slug: string;
  stage_name: string;
  archive_reason: string;
  cnt: number;
}

export interface IntakeAlarmBucket {
  bucket: string;
  cnt: number;
}

export interface IdleStaffRow {
  user_id: string;
  user_email: string;
}

export interface RelayGroupStats {
  cnt: number;
  touched: number;
  enrolled: number;
  tuition: number;
}

// Shared by every widget that pivots education_relay_aggregates rows by a
// different key (stage / position / person / branch) — same 4 summed fields
// every time, only the grouping key and label differ.
export function groupRelayRows(rows: RelayAggregateRow[], keyOf: (r: RelayAggregateRow) => string): Map<string, RelayGroupStats> {
  const byKey = new Map<string, RelayGroupStats>();
  for (const r of rows) {
    const key = keyOf(r);
    const existing = byKey.get(key) ?? { cnt: 0, touched: 0, enrolled: 0, tuition: 0 };
    existing.cnt += r.cnt;
    existing.touched += r.touched_cnt;
    existing.enrolled += r.enrolled_cnt;
    existing.tuition += r.tuition_value;
    byKey.set(key, existing);
  }
  return byKey;
}

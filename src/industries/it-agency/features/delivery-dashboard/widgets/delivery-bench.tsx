"use client";

import { useWidgetData } from "@/industries/_shared/features/insights/lib/use-widget-data";
import { WidgetCard, WidgetLoading, WidgetEmpty, WidgetError } from "./widget-shell";

// Bench / Idle Capacity — no new endpoint, reuses GET /api/v1/resourcing/utilization
// (per-member billableHours / netCapacityHours / utilizationPct this week). Flags
// members below the bench threshold (<60% utilization), sorted by idle hours
// (most idle first) — mirrors team-utilization's target band but this widget is
// the "who's redeployable" cut, not the full-team bar chart.
const BENCH_THRESHOLD_PCT = 60;

interface UtilizationRow {
  tenant_user_id: string;
  billableHours: number;
  netCapacityHours: number;
  utilizationPct: number;
}

interface TeamMember {
  id: string;
  name: string | null;
  email: string;
}

export default function DeliveryBenchWidget() {
  const { data: rows, loading: rowsLoading, error } = useWidgetData<UtilizationRow[]>(
    "/api/v1/resourcing/utilization"
  );
  const { data: team, loading: teamLoading } = useWidgetData<TeamMember[]>("/api/v1/team");

  const loading = rowsLoading || teamLoading;
  const memberById = new Map((team ?? []).map((m) => [m.id, m]));

  const bench = (rows ?? [])
    .filter((r) => r.netCapacityHours > 0 && r.utilizationPct < BENCH_THRESHOLD_PCT)
    .map((r) => ({ ...r, idleHours: Math.max(0, r.netCapacityHours - r.billableHours) }))
    .sort((a, b) => b.idleHours - a.idleHours);

  return (
    <WidgetCard title="Bench / Idle Capacity">
      {loading ? (
        <WidgetLoading />
      ) : error ? (
        <WidgetError message="Failed to load utilization." />
      ) : !rows || rows.length === 0 ? (
        <WidgetEmpty message="No utilization data yet." />
      ) : bench.length === 0 ? (
        <WidgetEmpty message="Nobody is under-utilized this week." />
      ) : (
        <div className="space-y-2">
          {bench.map((r) => {
            const member = memberById.get(r.tenant_user_id);
            return (
              <div key={r.tenant_user_id} className="flex items-center justify-between border rounded-lg px-3 py-2">
                <span className="text-sm font-medium truncate">{member?.name ?? member?.email ?? "Unknown"}</span>
                <span className="text-xs text-muted-foreground flex-shrink-0">
                  {r.idleHours.toFixed(1)}h idle ({r.utilizationPct}%)
                </span>
              </div>
            );
          })}
        </div>
      )}
    </WidgetCard>
  );
}

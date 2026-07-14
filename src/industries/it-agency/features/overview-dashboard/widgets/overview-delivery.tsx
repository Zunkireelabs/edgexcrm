"use client";

import { useWidgetData } from "@/industries/_shared/features/insights/lib/use-widget-data";
import { computeProjectHealth, type ProjectHealth } from "@/lib/projects/health";
import type { Project } from "@/types/database";
import { WidgetCard, WidgetLoading, WidgetEmpty, WidgetError, Stat, RAG_COLORS } from "./widget-shell";

// Bird's-eye delivery tile row for Company Overview. No new fetch surface —
// reuses GET /api/v1/projects (same computeProjectHealth logic as
// delivery-health.tsx / same >110%-of-estimate overrun rule as
// delivery-overrun.tsx) and GET /api/v1/resourcing/utilization (same rows
// team-utilization.tsx / delivery-bench.tsx already render).
const TERMINAL_STATUSES = new Set(["delivered", "cancelled"]);
const BENCH_THRESHOLD_PCT = 60;

interface DeliveryProject extends Project {
  actual_minutes: number;
  pct_complete: number;
}

interface UtilizationRow {
  tenant_user_id: string;
  billableHours: number;
  netCapacityHours: number;
  utilizationPct: number;
}

const RAG_LABELS: Record<ProjectHealth, string> = { green: "on-track", amber: "at-risk", red: "off-track" };
const RAG_ORDER: ProjectHealth[] = ["green", "amber", "red"];

function healthCounts(projects: DeliveryProject[]): Record<ProjectHealth, number> {
  const active = projects.filter((p) => p.status !== "cancelled");
  const counts: Record<ProjectHealth, number> = { green: 0, amber: 0, red: 0 };
  for (const p of active) {
    const health = computeProjectHealth({
      healthOverride: p.health_override,
      actualMinutes: p.actual_minutes,
      currentEstimateMinutes: p.current_estimate_minutes,
      targetEndDate: p.target_end_date,
      pctComplete: p.pct_complete,
    });
    counts[health]++;
  }
  return counts;
}

function HealthChips({ counts }: { counts: Record<ProjectHealth, number> }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {RAG_ORDER.map((h) => (
        <div key={h} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: RAG_COLORS[h] }} />
          <span className="text-lg font-bold">{counts[h]}</span>
          <span className="text-xs text-muted-foreground">{RAG_LABELS[h]}</span>
        </div>
      ))}
    </div>
  );
}

function overBudgetCount(projects: DeliveryProject[]): number {
  return projects.filter((p) => {
    if (TERMINAL_STATUSES.has(p.status)) return false;
    if (!p.current_estimate_minutes || p.current_estimate_minutes <= 0) return false;
    const ratioPct = (p.actual_minutes / p.current_estimate_minutes) * 100;
    return ratioPct > 110;
  }).length;
}

export default function OverviewDeliveryWidget() {
  const { data: projects, loading: projectsLoading, error: projectsError } = useWidgetData<DeliveryProject[]>(
    "/api/v1/projects"
  );
  const { data: utilization, loading: utilLoading, error: utilError } = useWidgetData<UtilizationRow[]>(
    "/api/v1/resourcing/utilization"
  );

  const loading = projectsLoading || utilLoading;
  const error = projectsError || utilError;

  return (
    <WidgetCard title="Delivery">
      {loading ? (
        <WidgetLoading />
      ) : error ? (
        <WidgetError message="Failed to load delivery overview." />
      ) : !projects || !utilization ? (
        <WidgetEmpty message="No delivery data yet." />
      ) : (
        <OverviewDeliveryContent projects={projects} utilization={utilization} />
      )}
    </WidgetCard>
  );
}

function OverviewDeliveryContent({
  projects,
  utilization,
}: {
  projects: DeliveryProject[];
  utilization: UtilizationRow[];
}) {
  const capacitied = utilization.filter((r) => r.netCapacityHours > 0);
  const avgUtilizationPct =
    capacitied.length > 0
      ? Math.round((capacitied.reduce((sum, r) => sum + r.utilizationPct, 0) / capacitied.length) * 10) / 10
      : 0;
  const benchPct =
    capacitied.length > 0
      ? Math.round(
          (capacitied.filter((r) => r.utilizationPct < BENCH_THRESHOLD_PCT).length / capacitied.length) * 1000
        ) / 10
      : 0;

  return (
    <div className="grid grid-cols-2 gap-4">
      <Stat
        label="Delivery Health"
        value={projects.length === 0 ? "—" : <HealthChips counts={healthCounts(projects)} />}
      />
      <Stat label="Projects Over Budget" value={String(overBudgetCount(projects))} />
      <Stat label="Team Utilization" value={`${avgUtilizationPct}%`} />
      <Stat label="Bench" value={`${benchPct}%`} />
    </div>
  );
}

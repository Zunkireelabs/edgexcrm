"use client";

import { useWidgetData } from "@/industries/_shared/features/insights/lib/use-widget-data";
import { computeProjectHealth, type ProjectHealth } from "@/lib/projects/health";
import type { Project } from "@/types/database";
import { WidgetCard, WidgetLoading, WidgetEmpty, WidgetError, RAG_COLORS } from "./widget-shell";

const RAG_LABELS: Record<ProjectHealth, string> = {
  green: "On track",
  amber: "At risk",
  red: "Off track",
};

// GET /api/v1/projects enriches each row with actual_minutes + pct_complete
// server-side (see route.ts) — not on the base Project type.
interface DeliveryProject extends Project {
  actual_minutes: number;
  pct_complete: number;
}

interface TeamMemberMinimal {
  user_id: string;
  name: string;
}

export default function DeliveryHealthWidget() {
  const { data: projects, loading, error } = useWidgetData<DeliveryProject[]>("/api/v1/projects");
  const { data: team } = useWidgetData<TeamMemberMinimal[]>("/api/v1/team?minimal=1");

  function ownerName(userId: string | null): string {
    if (!userId) return "Unassigned";
    return team?.find((m) => m.user_id === userId)?.name ?? "Unknown";
  }

  const active = (projects ?? []).filter((p) => p.status !== "cancelled");

  return (
    <WidgetCard title="Delivery Health">
      {loading ? (
        <WidgetLoading />
      ) : error ? (
        <WidgetError message="Failed to load delivery health." />
      ) : active.length === 0 ? (
        <WidgetEmpty message="No active projects yet." />
      ) : (
        <DeliveryHealthContent projects={active} ownerName={ownerName} />
      )}
    </WidgetCard>
  );
}

function DeliveryHealthContent({
  projects,
  ownerName,
}: {
  projects: DeliveryProject[];
  ownerName: (userId: string | null) => string;
}) {
  const withHealth = projects.map((p) => ({
    ...p,
    health: computeProjectHealth({
      healthOverride: p.health_override,
      actualMinutes: p.actual_minutes,
      currentEstimateMinutes: p.current_estimate_minutes,
      targetEndDate: p.target_end_date,
      pctComplete: p.pct_complete,
    }),
  }));

  const counts: Record<ProjectHealth, number> = { green: 0, amber: 0, red: 0 };
  for (const p of withHealth) counts[p.health]++;

  const atRisk = withHealth
    .filter((p) => p.health !== "green")
    .sort((a, b) => (a.health === b.health ? 0 : a.health === "red" ? -1 : 1));

  return (
    <div className="space-y-4">
      <div className="flex gap-5">
        {(["green", "amber", "red"] as ProjectHealth[]).map((h) => (
          <div key={h} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: RAG_COLORS[h] }} />
            <span className="text-sm font-semibold">{counts[h]}</span>
            <span className="text-xs text-muted-foreground">{RAG_LABELS[h]}</span>
          </div>
        ))}
      </div>

      {atRisk.length === 0 ? (
        <p className="text-sm text-muted-foreground">All projects on track.</p>
      ) : (
        <div className="space-y-2">
          {atRisk.map((p) => (
            <div key={p.id} className="flex items-center justify-between border rounded-lg px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="h-2 w-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: RAG_COLORS[p.health] }}
                />
                <span className="text-sm font-medium truncate">{p.name}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground flex-shrink-0">
                <span>{p.pct_complete}%</span>
                <span>{ownerName(p.owner_id)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import { useWidgetData } from "@/industries/_shared/features/insights/lib/use-widget-data";
import { WidgetCard, WidgetLoading, WidgetEmpty, WidgetError, RAG_COLORS } from "./widget-shell";

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

// Target band: 70-85% billable utilization. Below 70 => bench, above 100 => overload.
function barColor(pct: number): string {
  if (pct < 70) return RAG_COLORS.amber;
  if (pct <= 100) return RAG_COLORS.green;
  return RAG_COLORS.red;
}

export default function TeamUtilizationWidget() {
  const { data: rows, loading: rowsLoading, error: rowsError } = useWidgetData<UtilizationRow[]>(
    "/api/v1/resourcing/utilization"
  );
  const { data: team, loading: teamLoading } = useWidgetData<TeamMember[]>("/api/v1/team");

  const loading = rowsLoading || teamLoading;

  return (
    <WidgetCard title="Team Utilization">
      {loading ? (
        <WidgetLoading />
      ) : rowsError ? (
        <WidgetError message="Failed to load utilization." />
      ) : !rows || rows.length === 0 ? (
        <WidgetEmpty message="No utilization data yet." />
      ) : (
        <TeamUtilizationContent rows={rows} team={team ?? []} />
      )}
    </WidgetCard>
  );
}

function TeamUtilizationContent({ rows, team }: { rows: UtilizationRow[]; team: TeamMember[] }) {
  const memberById = new Map(team.map((m) => [m.id, m]));

  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const member = memberById.get(r.tenant_user_id);
        const widthPct = Math.min(r.utilizationPct, 100);
        return (
          <div key={r.tenant_user_id}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium">{member?.name ?? member?.email ?? "Unknown"}</span>
              <span className="text-xs text-muted-foreground">
                {r.billableHours.toFixed(1)}h / {r.netCapacityHours.toFixed(1)}h ({r.utilizationPct}%)
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${widthPct}%`, backgroundColor: barColor(r.utilizationPct) }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

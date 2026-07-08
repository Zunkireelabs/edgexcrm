"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { Loader2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface UtilizationRow {
  tenant_user_id: string;
  billableHours: number;
  capacityHours: number;
  utilizationPct: number;
  allocations: Array<{ id: string; project_id: string; project_name: string | null; hours_per_week: number; role_on_project: string | null }>;
}

interface TeamMember {
  id: string;
  name: string | null;
  email: string;
}

function barColor(pct: number): string {
  if (pct === 0) return "bg-gray-300";
  if (pct < 60) return "bg-amber-400";
  if (pct <= 100) return "bg-emerald-500";
  return "bg-red-500";
}

export function UtilizationDashboard() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<UtilizationRow[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [utilRes, teamRes] = await Promise.all([
        fetch("/api/v1/resourcing/utilization"),
        fetch("/api/v1/team"),
      ]);
      const [utilJson, teamJson] = await Promise.all([utilRes.json(), teamRes.json()]);
      setRows((utilJson.data ?? []) as UtilizationRow[]);
      setTeam((teamJson.data ?? []) as TeamMember[]);
    } catch {
      toast.error("Failed to load utilization data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const memberById = useMemo(() => new Map(team.map((m) => [m.id, m])), [team]);
  const bench = useMemo(() => rows.filter((r) => r.allocations.length === 0), [rows]);
  const underUtilized = useMemo(() => rows.filter((r) => r.allocations.length > 0 && r.utilizationPct < 60), [rows]);
  const overUtilized = useMemo(() => rows.filter((r) => r.utilizationPct > 100), [rows]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2 overflow-y-auto pr-6">
      <h1 className="text-lg font-bold mb-4">Utilization</h1>

      {rows.length === 0 ? (
        <div className="border rounded-xl p-12 text-center bg-card">
          <Users className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground text-sm">No approved billable time entries yet.</p>
        </div>
      ) : (
        <>
          <div className="flex gap-2 mb-4">
            {overUtilized.length > 0 && <Badge variant="destructive">{overUtilized.length} over-utilized</Badge>}
            {underUtilized.length > 0 && <Badge variant="secondary">{underUtilized.length} under-utilized</Badge>}
            {bench.length > 0 && <Badge variant="outline">{bench.length} on the bench</Badge>}
          </div>

          <div className="space-y-3">
            {rows.map((r) => {
              const member = memberById.get(r.tenant_user_id);
              const pct = Math.min(r.utilizationPct, 150);
              return (
                <div key={r.tenant_user_id} className="border rounded-lg p-3 bg-card">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium">{member?.name ?? member?.email ?? "Unknown"}</span>
                    <span className="text-xs text-muted-foreground">
                      {r.billableHours.toFixed(1)}h / {r.capacityHours}h ({r.utilizationPct}%)
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${barColor(r.utilizationPct)}`}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                  {r.allocations.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1.5">
                      {r.allocations.map((a) => `${a.project_name ?? "Unknown"} (${a.hours_per_week}h)`).join(", ")}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

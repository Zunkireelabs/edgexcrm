"use client";

import { useWidgetData } from "@/industries/_shared/features/insights/lib/use-widget-data";
import type { Project } from "@/types/database";
import { WidgetCard, WidgetLoading, WidgetEmpty, WidgetError, RAG_COLORS } from "./widget-shell";

// Estimate vs Actual / Overrun — no new endpoint, reuses GET /api/v1/projects
// (already returns actual_minutes + current_estimate_minutes per project).
// Bucketed by actual/estimate ratio: green <90%, amber 90-110%, red >110%.
// Only non-delivered, non-cancelled projects with a real estimate are considered
// (a delivered project running over its estimate is a closed-book margin fact,
// not something anyone can still act on; projects without an estimate can't be
// bucketed at all).
const TERMINAL_STATUSES = new Set(["delivered", "cancelled"]);

interface TeamMemberMinimal {
  user_id: string;
  name: string;
}

interface OverrunRow {
  project: Project;
  ratioPct: number;
  bucket: "green" | "amber" | "red";
}

function bucketFor(ratioPct: number): "green" | "amber" | "red" {
  if (ratioPct > 110) return "red";
  if (ratioPct >= 90) return "amber";
  return "green";
}

export default function DeliveryOverrunWidget() {
  const { data: projects, loading, error } = useWidgetData<Project[]>("/api/v1/projects");
  const { data: team } = useWidgetData<TeamMemberMinimal[]>("/api/v1/team?minimal=1");
  const nameByUserId = new Map((team ?? []).map((m) => [m.user_id, m.name]));

  const rows: OverrunRow[] = (projects ?? [])
    .filter((p) => !TERMINAL_STATUSES.has(p.status) && p.current_estimate_minutes && p.current_estimate_minutes > 0)
    .map((p) => {
      const ratioPct = Math.round(((p.actual_minutes ?? 0) / p.current_estimate_minutes!) * 1000) / 10;
      return { project: p, ratioPct, bucket: bucketFor(ratioPct) };
    })
    .sort((a, b) => b.ratioPct - a.ratioPct);

  const flagged = rows.filter((r) => r.bucket !== "green");

  return (
    <WidgetCard title="Estimate vs Actual / Overrun">
      {loading ? (
        <WidgetLoading />
      ) : error ? (
        <WidgetError message="Failed to load project estimates." />
      ) : rows.length === 0 ? (
        <WidgetEmpty message="No active projects with an estimate yet." />
      ) : flagged.length === 0 ? (
        <WidgetEmpty message={`All ${rows.length} estimated projects are on track.`} />
      ) : (
        <div className="space-y-2">
          {flagged.map((r) => (
            <div key={r.project.id} className="flex items-center justify-between border rounded-lg px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{r.project.name}</div>
                <div className="text-xs text-muted-foreground">
                  {Math.round((r.project.actual_minutes ?? 0) / 60)}h / {Math.round(r.project.current_estimate_minutes! / 60)}h
                  {r.project.owner_id && <span> — {nameByUserId.get(r.project.owner_id) ?? "Unknown"}</span>}
                </div>
              </div>
              <span
                className="text-xs font-semibold px-2 py-1 rounded-full flex-shrink-0"
                style={{ color: RAG_COLORS[r.bucket], backgroundColor: `${RAG_COLORS[r.bucket]}1a` }}
              >
                {r.ratioPct}%
              </span>
            </div>
          ))}
          {rows.length > flagged.length && (
            <p className="text-xs text-muted-foreground pt-1">
              {rows.length - flagged.length} other estimated project{rows.length - flagged.length === 1 ? "" : "s"} on track.
            </p>
          )}
        </div>
      )}
    </WidgetCard>
  );
}

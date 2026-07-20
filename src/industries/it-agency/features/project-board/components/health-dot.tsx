import { computeProjectHealth } from "@/lib/projects/health";
import type { Project } from "@/types/database";

const DOT_CLASS: Record<"green" | "amber" | "red", string> = {
  green: "bg-green-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
};

interface HealthDotProps {
  project: Pick<
    Project,
    "health_override" | "current_estimate_minutes" | "target_end_date" | "actual_minutes" | "pct_complete"
  >;
}

/** Board-card health signal. Uses the same authoritative inputs as the
 * cockpit's `GET /api/v1/projects/[id]` — `actual_minutes` and
 * `pct_complete` are computed server-side (batched, no N+1) on the board
 * list endpoint `GET /api/v1/projects` so this dot never disagrees with
 * the cockpit's HealthBanner for the same project. */
export function HealthDot({ project }: HealthDotProps) {
  if (project.current_estimate_minutes == null) return null;

  const actualMinutes = project.actual_minutes ?? 0;
  const pctComplete = project.pct_complete ?? 0;

  const health = computeProjectHealth({
    healthOverride: project.health_override,
    actualMinutes,
    currentEstimateMinutes: project.current_estimate_minutes,
    targetEndDate: project.target_end_date,
    pctComplete,
  });

  const barPct =
    project.current_estimate_minutes > 0
      ? Math.min(100, Math.round((actualMinutes / project.current_estimate_minutes) * 100))
      : 0;

  return (
    <div className="flex items-center gap-1.5" title={`${health} · ${(actualMinutes / 60).toFixed(1)}h of ${(project.current_estimate_minutes / 60).toFixed(1)}h`}>
      <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${DOT_CLASS[health]}`} />
      <div className="h-1 w-10 rounded-full bg-black/5 overflow-hidden">
        <div className={`h-full rounded-full ${DOT_CLASS[health]}`} style={{ width: `${barPct}%` }} />
      </div>
    </div>
  );
}

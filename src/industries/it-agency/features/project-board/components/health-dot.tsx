import { computeProjectHealth } from "@/lib/projects/health";
import type { Project } from "@/types/database";

const DOT_CLASS: Record<"green" | "amber" | "red", string> = {
  green: "bg-green-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
};

interface HealthDotProps {
  project: Pick<Project, "health_override" | "current_estimate_minutes">;
  /** Billable minutes proxy for actual — the board list doesn't fetch full
   * time_entries/task data, so this is a lighter-weight approximation of
   * the authoritative health computed on the project cockpit page. */
  billableMinutes: number;
}

/** Small budget-ratio health signal for board cards. Deliberately omits the
 * due-date clause of the full health rule (no reliable pct_complete at
 * board-list scope) — see the project cockpit page for the authoritative
 * health computation. */
export function HealthDot({ project, billableMinutes }: HealthDotProps) {
  if (project.current_estimate_minutes == null) return null;

  const health = computeProjectHealth({
    healthOverride: project.health_override,
    actualMinutes: billableMinutes,
    currentEstimateMinutes: project.current_estimate_minutes,
    targetEndDate: null,
    pctComplete: 0,
  });

  const barPct =
    project.current_estimate_minutes > 0
      ? Math.min(100, Math.round((billableMinutes / project.current_estimate_minutes) * 100))
      : 0;

  return (
    <div className="flex items-center gap-1.5" title={`${health} · ${(billableMinutes / 60).toFixed(1)}h of ${(project.current_estimate_minutes / 60).toFixed(1)}h`}>
      <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${DOT_CLASS[health]}`} />
      <div className="h-1 w-10 rounded-full bg-black/5 overflow-hidden">
        <div className={`h-full rounded-full ${DOT_CLASS[health]}`} style={{ width: `${barPct}%` }} />
      </div>
    </div>
  );
}

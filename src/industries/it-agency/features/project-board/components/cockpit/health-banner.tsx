import { AlertTriangle, CheckCircle2, AlertCircle } from "lucide-react";
import type { Project, ProjectHealth } from "@/types/database";

const HEALTH_CONFIG: Record<ProjectHealth, { label: string; bg: string; text: string; bar: string; icon: typeof CheckCircle2 }> = {
  green: { label: "On track", bg: "bg-green-50", text: "text-green-700", bar: "bg-green-500", icon: CheckCircle2 },
  amber: { label: "At risk", bg: "bg-amber-50", text: "text-amber-700", bar: "bg-amber-500", icon: AlertTriangle },
  red: { label: "Off track", bg: "bg-red-50", text: "text-red-700", bar: "bg-red-500", icon: AlertCircle },
};

function formatHours(minutes: number): string {
  return (minutes / 60).toFixed(1);
}

interface HealthBannerProps {
  project: Project;
}

export function HealthBanner({ project }: HealthBannerProps) {
  const health = project.health ?? "green";
  const pctComplete = project.pct_complete ?? 0;
  const actualMinutes = project.actual_minutes ?? 0;
  const estimateMinutes = project.current_estimate_minutes ?? 0;
  const cfg = HEALTH_CONFIG[health];
  const Icon = cfg.icon;

  const barPct = estimateMinutes > 0 ? Math.min(100, Math.round((actualMinutes / estimateMinutes) * 100)) : 0;

  return (
    <div className={`rounded-lg border p-4 ${cfg.bg}`}>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Icon className={`h-5 w-5 ${cfg.text}`} />
          <span className={`text-sm font-semibold ${cfg.text}`}>{cfg.label}</span>
          {project.health_override && (
            <span className="text-xs text-muted-foreground">(manual override)</span>
          )}
        </div>
        <div className="flex items-center gap-6 text-sm">
          <div>
            <span className="text-muted-foreground">Complete </span>
            <span className="font-semibold text-foreground">{pctComplete}%</span>
          </div>
          <div>
            <span className="text-muted-foreground">Hours </span>
            <span className="font-semibold text-foreground">
              {formatHours(actualMinutes)}
              {estimateMinutes > 0 && <span className="text-muted-foreground"> / {formatHours(estimateMinutes)}</span>}
            </span>
          </div>
          {project.baseline_estimate_minutes != null &&
            project.current_estimate_minutes != null &&
            project.current_estimate_minutes !== project.baseline_estimate_minutes && (
              <div>
                <span className="text-muted-foreground">Baseline </span>
                <span className="font-semibold text-foreground">{formatHours(project.baseline_estimate_minutes)}h</span>
              </div>
            )}
        </div>
      </div>

      {estimateMinutes > 0 && (
        <div className="mt-3 h-2 w-full rounded-full bg-black/5 overflow-hidden">
          <div className={`h-full rounded-full ${cfg.bar}`} style={{ width: `${barPct}%` }} />
        </div>
      )}

      {project.health_note && <p className="mt-2 text-xs text-muted-foreground">{project.health_note}</p>}
    </div>
  );
}

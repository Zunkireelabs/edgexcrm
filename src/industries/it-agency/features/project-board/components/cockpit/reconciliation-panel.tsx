"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import type { ReconciliationRollup, TaskReconciliation } from "../../hooks/use-project-reconciliation";

function formatHours(minutes: number): string {
  return (minutes / 60).toFixed(1);
}

function varianceColor(pct: number | null): string {
  if (pct == null) return "text-muted-foreground";
  if (pct > 10) return "text-red-600";
  if (pct > 0) return "text-amber-600";
  return "text-green-600";
}

interface ReconciliationPanelProps {
  tasks: TaskReconciliation[];
  rollup: ReconciliationRollup | null;
  loading: boolean;
  onReconcile: (taskId: string) => Promise<boolean>;
}

export function ReconciliationPanel({ tasks, rollup, loading, onReconcile }: ReconciliationPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Estimate vs. actual</CardTitle>
        <CardDescription>Per-task reconciliation against logged time.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!loading && tasks.length === 0 && (
          <p className="text-sm text-muted-foreground italic">No tasks on this project yet.</p>
        )}

        {tasks.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border/50">
                  <th className="font-medium py-1.5 pr-3">Task</th>
                  <th className="font-medium py-1.5 pr-3">Est.</th>
                  <th className="font-medium py-1.5 pr-3">Actual</th>
                  <th className="font-medium py-1.5 pr-3">Variance</th>
                  <th className="font-medium py-1.5" />
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.task_id} className="border-b border-border/30 last:border-0">
                    <td className="py-1.5 pr-3 truncate max-w-48">{t.title}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground">
                      {t.estimated_minutes != null ? `${formatHours(t.estimated_minutes)}h` : "—"}
                    </td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{formatHours(t.actual_minutes)}h</td>
                    <td className={`py-1.5 pr-3 font-medium ${varianceColor(t.variance_pct)}`}>
                      {t.variance_pct != null ? `${t.variance_pct > 0 ? "+" : ""}${t.variance_pct}%` : "—"}
                    </td>
                    <td className="py-1.5">
                      <Button variant="ghost" size="sm" onClick={() => onReconcile(t.task_id)} title="Reconcile — record in timeline">
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {rollup && (
          <div className="flex items-center justify-between pt-2 border-t border-border/50 text-sm">
            <span className="text-muted-foreground">Project roll-up</span>
            <span>
              {formatHours(rollup.actual_minutes)}h / {formatHours(rollup.estimate_minutes)}h
              {rollup.variance_pct != null && (
                <span className={`ml-2 font-medium ${varianceColor(rollup.variance_pct)}`}>
                  {rollup.variance_pct > 0 ? "+" : ""}
                  {rollup.variance_pct}%
                </span>
              )}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

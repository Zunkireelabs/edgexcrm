"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";

export interface TaskReconciliation {
  task_id: string;
  title: string;
  status: string;
  estimated_minutes: number | null;
  actual_minutes: number;
  variance_minutes: number | null;
  variance_pct: number | null;
}

export interface ReconciliationRollup {
  estimate_minutes: number;
  actual_minutes: number;
  variance_minutes: number | null;
  variance_pct: number | null;
}

export function useProjectReconciliation(projectId: string) {
  const [tasks, setTasks] = useState<TaskReconciliation[]>([]);
  const [rollup, setRollup] = useState<ReconciliationRollup | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/reconciliation`).then((r) => r.json());
      setTasks(res.data?.tasks ?? []);
      setRollup(res.data?.rollup ?? null);
    } catch {
      toast.error("Failed to load reconciliation");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function reconcileTask(taskId: string): Promise<boolean> {
    const res = await fetch(`/api/v1/tasks/${taskId}/reconcile`, { method: "POST" });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error?.message ?? "Failed to reconcile task");
      return false;
    }
    toast.success("Task reconciled — recorded in the project timeline");
    await load();
    return true;
  }

  return { tasks, rollup, loading, reconcileTask, refetch: load };
}

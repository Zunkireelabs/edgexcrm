"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import type { ProjectStatusReport } from "@/types/database";

export function useProjectStatusReports(projectId: string) {
  const [reports, setReports] = useState<ProjectStatusReport[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/status-reports`).then((r) => r.json());
      setReports(res.data ?? []);
    } catch {
      toast.error("Failed to load status reports");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function createDraft(fields: {
    summary?: string;
    accomplishments?: string;
    in_progress?: string;
    risks?: string;
    asks?: string;
    client_message?: string;
  }): Promise<boolean> {
    const res = await fetch(`/api/v1/projects/${projectId}/status-reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error?.message ?? "Failed to save draft");
      return false;
    }
    await load();
    return true;
  }

  async function publish(reportId: string): Promise<boolean> {
    const res = await fetch(`/api/v1/status-reports/${reportId}/publish`, { method: "POST" });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error?.message ?? "Failed to publish status report");
      return false;
    }
    await load();
    return true;
  }

  return { reports, loading, createDraft, publish, refetch: load };
}

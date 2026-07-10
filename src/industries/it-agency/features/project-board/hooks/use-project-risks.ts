"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import type { ProjectRisk } from "@/types/database";

export function useProjectRisks(projectId: string) {
  const [risks, setRisks] = useState<ProjectRisk[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/risks`).then((r) => r.json());
      setRisks(res.data ?? []);
    } catch {
      toast.error("Failed to load risks");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function createRisk(payload: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(`/api/v1/projects/${projectId}/risks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error?.message ?? "Failed to create risk");
      return false;
    }
    await load();
    return true;
  }

  async function updateRisk(riskId: string, patch: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(`/api/v1/risks/${riskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error?.message ?? "Failed to update risk");
      return false;
    }
    await load();
    return true;
  }

  return { risks, loading, createRisk, updateRisk, refetch: load };
}

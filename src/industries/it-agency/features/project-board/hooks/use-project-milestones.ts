"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import type { ProjectMilestone } from "@/types/database";

export function useProjectMilestones(projectId: string) {
  const [milestones, setMilestones] = useState<ProjectMilestone[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/milestones`).then((r) => r.json());
      setMilestones(res.data ?? []);
    } catch {
      toast.error("Failed to load milestones");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function createMilestone(payload: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(`/api/v1/projects/${projectId}/milestones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error?.message ?? "Failed to create milestone");
      return false;
    }
    await load();
    return true;
  }

  async function acceptMilestone(milestoneId: string): Promise<boolean> {
    const res = await fetch(`/api/v1/milestones/${milestoneId}/accept`, { method: "POST" });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error?.message ?? "Failed to accept milestone");
      return false;
    }
    await load();
    return true;
  }

  async function rejectMilestone(milestoneId: string, reason?: string): Promise<boolean> {
    const res = await fetch(`/api/v1/milestones/${milestoneId}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error?.message ?? "Failed to reject milestone");
      return false;
    }
    await load();
    return true;
  }

  async function transitionMilestone(milestoneId: string, to: string): Promise<boolean> {
    const res = await fetch(`/api/v1/milestones/${milestoneId}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to }),
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error?.message ?? "Failed to update milestone");
      return false;
    }
    await load();
    return true;
  }

  return { milestones, loading, createMilestone, acceptMilestone, rejectMilestone, transitionMilestone, refetch: load };
}

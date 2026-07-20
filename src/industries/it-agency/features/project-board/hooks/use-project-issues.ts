"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import type { ProjectIssue } from "@/types/database";

export function useProjectIssues(projectId: string) {
  const [issues, setIssues] = useState<ProjectIssue[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/issues`).then((r) => r.json());
      setIssues(res.data ?? []);
    } catch {
      toast.error("Failed to load issues");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function createIssue(payload: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(`/api/v1/projects/${projectId}/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error?.message ?? "Failed to create issue");
      return false;
    }
    await load();
    return true;
  }

  async function updateIssue(issueId: string, patch: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(`/api/v1/issues/${issueId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error?.message ?? "Failed to update issue");
      return false;
    }
    await load();
    return true;
  }

  return { issues, loading, createIssue, updateIssue, refetch: load };
}

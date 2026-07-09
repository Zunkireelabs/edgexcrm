"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import type { ProjectChangeRequest } from "@/types/database";

export function useProjectChangeRequests(projectId: string) {
  const [changeRequests, setChangeRequests] = useState<ProjectChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/change-requests`).then((r) => r.json());
      setChangeRequests(res.data ?? []);
    } catch {
      toast.error("Failed to load change requests");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function createChangeRequest(payload: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(`/api/v1/projects/${projectId}/change-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error?.message ?? "Failed to create change request");
      return false;
    }
    await load();
    return true;
  }

  async function approveChangeRequest(id: string, clientApproved: boolean): Promise<boolean> {
    const res = await fetch(`/api/v1/change-requests/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_approved: clientApproved }),
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error?.message ?? "Failed to approve change request");
      return false;
    }
    await load();
    return true;
  }

  async function rejectChangeRequest(id: string, reason?: string): Promise<boolean> {
    const res = await fetch(`/api/v1/change-requests/${id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error?.message ?? "Failed to reject change request");
      return false;
    }
    await load();
    return true;
  }

  return {
    changeRequests,
    loading,
    createChangeRequest,
    approveChangeRequest,
    rejectChangeRequest,
    refetch: load,
  };
}

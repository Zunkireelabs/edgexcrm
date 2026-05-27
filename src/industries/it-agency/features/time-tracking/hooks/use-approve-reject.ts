"use client";

import { useState } from "react";
import { toast } from "sonner";

export function useApproveReject(opts: {
  onSuccess?: (id: string, action: "approve" | "reject") => void;
} = {}) {
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());

  async function approve(id: string): Promise<void> {
    setProcessingIds((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/v1/time-entries/${id}/approve`, { method: "POST" });
      if (!res.ok) {
        const { error: apiErr } = await res.json().catch(() => ({}));
        throw new Error(apiErr?.message ?? "Failed to approve");
      }
      toast.success("Entry approved");
      opts.onSuccess?.(id, "approve");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to approve");
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  async function reject(id: string, reason: string): Promise<void> {
    setProcessingIds((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/v1/time-entries/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const { error: apiErr } = await res.json().catch(() => ({}));
        throw new Error(apiErr?.message ?? "Failed to reject");
      }
      toast.success("Entry rejected");
      opts.onSuccess?.(id, "reject");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reject");
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  return { approve, reject, processingIds };
}

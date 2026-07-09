"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import type { Invoice } from "@/types/database";

export interface BillableMilestone {
  id: string;
  title: string;
  amount: number;
  due_date: string | null;
}

export function useProjectInvoices(projectId: string) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [billableMilestones, setBillableMilestones] = useState<BillableMilestone[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/invoices`).then((r) => r.json());
      setInvoices(res.data?.invoices ?? []);
      setBillableMilestones(res.data?.billableMilestones ?? []);
    } catch {
      toast.error("Failed to load invoices");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function generateInvoice(milestoneIds: string[]): Promise<boolean> {
    const res = await fetch(`/api/v1/projects/${projectId}/invoices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ milestone_ids: milestoneIds }),
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error?.message ?? "Failed to generate invoice");
      return false;
    }
    await load();
    return true;
  }

  return { invoices, billableMilestones, loading, generateInvoice, refetch: load };
}

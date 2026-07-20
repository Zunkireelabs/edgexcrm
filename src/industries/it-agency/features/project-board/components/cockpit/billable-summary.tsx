"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { DollarSign, Loader2 } from "lucide-react";
import {
  calculateBillableMinutes,
  calculateBillableAmount,
  calculateCostAmount,
  calculateMargin,
} from "../../../time-tracking/lib/totals";
import { formatMinutes } from "../../../time-tracking/hooks/use-time-entries";
import type { TimeEntry } from "@/types/database";

interface BillableSummaryProps {
  projectId: string;
  // Cost/margin exposes staff-cost information — admin/owner only.
  isAdmin: boolean;
}

export function BillableSummary({ projectId, isAdmin }: BillableSummaryProps) {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/time-entries?project_id=${projectId}&approval_status=approved`);
      const { data } = await res.json();
      setEntries(data ?? []);
    } catch {
      toast.error("Failed to load billable summary");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const billableMinutes = calculateBillableMinutes(entries);
  const billableAmount = calculateBillableAmount(entries);
  const costAmount = calculateCostAmount(entries);
  const { margin, marginPct } = calculateMargin(billableAmount, costAmount);
  const negativeMargin = margin < 0;

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <DollarSign className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Hours &amp; margin</h3>
      </div>
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Billable hours</span>
            <span className="font-medium tabular-nums">{formatMinutes(billableMinutes)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Billable amount</span>
            <span className="font-medium tabular-nums">${billableAmount.toFixed(2)}</span>
          </div>
          {isAdmin && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Cost</span>
              <span className="font-medium tabular-nums">${costAmount.toFixed(2)}</span>
            </div>
          )}
          {isAdmin && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Margin</span>
              <span className={`font-medium tabular-nums ${negativeMargin ? "text-destructive" : ""}`}>
                ${margin.toFixed(2)}
                {marginPct != null && (
                  <span className="text-xs font-normal ml-1">({(marginPct * 100).toFixed(0)}%)</span>
                )}
                {negativeMargin && <span className="ml-1 text-xs font-normal">⚠</span>}
              </span>
            </div>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground mt-3">Approved entries only</p>
    </div>
  );
}

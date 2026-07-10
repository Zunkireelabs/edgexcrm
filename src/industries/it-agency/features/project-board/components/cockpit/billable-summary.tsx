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
    <div className="flex items-center gap-4 p-4 rounded-lg border bg-muted/30">
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <>
          <DollarSign className="h-5 w-5 text-muted-foreground shrink-0" />
          <div className="flex items-center gap-6 flex-wrap">
            <div>
              <p className="text-xs text-muted-foreground">Billable hours</p>
              <p className="text-lg font-semibold tabular-nums">{formatMinutes(billableMinutes)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Billable amount</p>
              <p className="text-lg font-semibold tabular-nums">${billableAmount.toFixed(2)}</p>
            </div>
            {isAdmin && (
              <div>
                <p className="text-xs text-muted-foreground">Cost</p>
                <p className="text-lg font-semibold tabular-nums">${costAmount.toFixed(2)}</p>
              </div>
            )}
            {isAdmin && (
              <div>
                <p className="text-xs text-muted-foreground">Margin</p>
                <p className={`text-lg font-semibold tabular-nums ${negativeMargin ? "text-destructive" : ""}`}>
                  ${margin.toFixed(2)}
                  {marginPct != null && (
                    <span className="text-xs font-normal ml-1">({(marginPct * 100).toFixed(0)}%)</span>
                  )}
                  {negativeMargin && <span className="ml-1 text-xs font-normal">⚠</span>}
                </p>
              </div>
            )}
            <p className="text-xs text-muted-foreground self-end mb-0.5">Approved entries only</p>
          </div>
        </>
      )}
    </div>
  );
}

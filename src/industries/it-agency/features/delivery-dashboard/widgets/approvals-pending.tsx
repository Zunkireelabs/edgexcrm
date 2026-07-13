"use client";

import { useWidgetData } from "@/industries/_shared/features/insights/lib/use-widget-data";
import { WidgetCard, WidgetLoading, WidgetEmpty, WidgetError } from "./widget-shell";

interface ApprovalsSummary {
  counts: {
    timeEntries: number;
    milestones: number;
    changeRequests: number;
    total: number;
  };
}

export default function ApprovalsPendingWidget() {
  const { data, loading, error, status } = useWidgetData<ApprovalsSummary>("/api/v1/approvals");

  return (
    <WidgetCard title="Approvals Pending">
      {loading ? (
        <WidgetLoading />
      ) : status === 403 ? (
        <WidgetEmpty message="Admin only." />
      ) : error ? (
        <WidgetError message="Failed to load approvals." />
      ) : !data ? (
        <WidgetEmpty message="No approvals pending." />
      ) : (
        <div className="space-y-2">
          <div className="text-3xl font-bold">{data.counts.total}</div>
          <div className="text-xs text-muted-foreground space-y-0.5">
            <div>{data.counts.timeEntries} time entries</div>
            <div>{data.counts.milestones} milestones</div>
            <div>{data.counts.changeRequests} change requests</div>
          </div>
        </div>
      )}
    </WidgetCard>
  );
}

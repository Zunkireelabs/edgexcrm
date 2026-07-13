"use client";

import { useWidgetData } from "@/industries/_shared/features/insights/lib/use-widget-data";
import { WidgetCard, WidgetLoading, WidgetEmpty, WidgetError } from "./widget-shell";

interface ProposalEngagement {
  draftCount: number;
  sentCount: number;
  acceptedCount: number;
  rejectedCount: number;
  expiredCount: number;
  viewedCount: number;
  acceptanceRatePct: number;
  avgHoursToView: number | null;
  avgHoursToAccept: number | null;
}

export default function SalesProposalsWidget() {
  const { data, loading, error } = useWidgetData<ProposalEngagement>("/api/v1/insights/sales/proposals");

  const total = data
    ? data.draftCount + data.sentCount + data.acceptedCount + data.rejectedCount + data.expiredCount
    : 0;

  return (
    <WidgetCard title="Proposal Engagement">
      {loading ? (
        <WidgetLoading />
      ) : error ? (
        <WidgetError message="Failed to load proposal engagement." />
      ) : !data || total === 0 ? (
        <WidgetEmpty message="No proposals yet." />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <Stat label="Sent" value={String(data.sentCount)} />
          <Stat label="Accepted" value={String(data.acceptedCount)} valueClassName="text-green-600" />
          <Stat label="Viewed" value={String(data.viewedCount)} />
          <Stat label="Acceptance Rate" value={`${data.acceptanceRatePct}%`} />
          <Stat label="Avg Time to View" value={data.avgHoursToView === null ? "—" : `${data.avgHoursToView}h`} />
          <Stat label="Avg Time to Accept" value={data.avgHoursToAccept === null ? "—" : `${data.avgHoursToAccept}h`} />
        </div>
      )}
    </WidgetCard>
  );
}

function Stat({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="space-y-0.5">
      <div className={`text-2xl font-bold truncate ${valueClassName ?? ""}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

"use client";

import { useWidgetData } from "@/industries/_shared/features/insights/lib/use-widget-data";
import { formatMoney } from "@/lib/travel/currency";
import { WidgetCard, WidgetLoading, WidgetEmpty, WidgetError } from "./widget-shell";

interface DealsSummary {
  winRatePct: number;
  openCount: number;
  weightedPipeline: number;
  bookingsWonMTD: number;
  currency: string;
}

export default function SalesDealsSummaryWidget() {
  const { data, loading, error } = useWidgetData<DealsSummary>("/api/v1/insights/sales/deals-summary");

  return (
    <WidgetCard title="Deals Snapshot">
      {loading ? (
        <WidgetLoading />
      ) : error ? (
        <WidgetError message="Failed to load deals summary." />
      ) : !data ? (
        <WidgetEmpty message="No deals yet." />
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Win Rate" value={`${data.winRatePct}%`} />
          <Stat label="Open Deals" value={String(data.openCount)} />
          <Stat label="Weighted Pipeline" value={formatMoney(data.weightedPipeline, data.currency)} />
          <Stat label="Bookings Won (MTD)" value={formatMoney(data.bookingsWonMTD, data.currency)} />
        </div>
      )}
    </WidgetCard>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-2xl font-bold truncate">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

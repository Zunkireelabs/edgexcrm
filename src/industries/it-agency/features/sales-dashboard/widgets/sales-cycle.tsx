"use client";

import { useWidgetData } from "@/industries/_shared/features/insights/lib/use-widget-data";
import { WidgetCard, WidgetLoading, WidgetEmpty, WidgetError } from "./widget-shell";

interface SalesCycle {
  avgDays: number;
  medianDays: number;
  sampleSize: number;
}

export default function SalesCycleWidget() {
  const { data, loading, error } = useWidgetData<SalesCycle>("/api/v1/insights/sales/cycle");

  return (
    <WidgetCard title="Sales Cycle Length">
      {loading ? (
        <WidgetLoading />
      ) : error ? (
        <WidgetError message="Failed to load sales cycle length." />
      ) : !data || data.sampleSize === 0 ? (
        <WidgetEmpty message="No converted leads yet." />
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Avg Days" value={`${data.avgDays}`} />
          <Stat label="Median Days" value={`${data.medianDays}`} />
          <div className="col-span-2 text-xs text-muted-foreground">Based on {data.sampleSize} converted leads</div>
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

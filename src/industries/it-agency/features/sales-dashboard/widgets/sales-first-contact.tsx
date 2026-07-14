"use client";

import { useWidgetData } from "@/industries/_shared/features/insights/lib/use-widget-data";
import { WidgetCard, WidgetLoading, WidgetEmpty, WidgetError } from "./widget-shell";

interface FirstContact {
  avgHours: number;
  medianHours: number;
  sampleSize: number;
}

export default function SalesFirstContactWidget() {
  const { data, loading, error } = useWidgetData<FirstContact>("/api/v1/insights/sales/first-contact");

  return (
    <WidgetCard title="Time to First Contact">
      {loading ? (
        <WidgetLoading />
      ) : error ? (
        <WidgetError message="Failed to load time to first contact." />
      ) : !data || data.sampleSize === 0 ? (
        <WidgetEmpty message="No logged activities yet." />
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Avg Hours" value={`${data.avgHours}`} />
          <Stat label="Median Hours" value={`${data.medianHours}`} />
          <div className="col-span-2 text-xs text-muted-foreground">Based on {data.sampleSize} leads</div>
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

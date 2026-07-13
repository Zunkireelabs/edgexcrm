"use client";

import { useWidgetData } from "@/industries/_shared/features/insights/lib/use-widget-data";
import { WidgetCard, WidgetLoading, WidgetEmpty, WidgetError } from "./widget-shell";

interface SummaryRow {
  key: string;
  label: string;
  minutes: number;
  billable_minutes: number;
  billable_amount: number;
}

export default function DeliveryByDepartmentWidget() {
  const { data: rows, loading, error } = useWidgetData<SummaryRow[]>(
    "/api/v1/time-entries/summary?dimension=department"
  );

  const withHours = (rows ?? []).filter((r) => r.minutes > 0);
  const maxHours = Math.max(...withHours.map((r) => r.minutes / 60), 1);

  return (
    <WidgetCard title="Delivery by Department">
      {loading ? (
        <WidgetLoading />
      ) : error ? (
        <WidgetError message="Failed to load department data." />
      ) : withHours.length === 0 ? (
        <WidgetEmpty message="No time entries with a department yet." />
      ) : (
        <div className="space-y-3">
          {withHours.map((r) => {
            const hours = r.minutes / 60;
            const billableHours = r.billable_minutes / 60;
            const widthPct = (hours / maxHours) * 100;
            return (
              <div key={r.key}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">{r.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {hours.toFixed(1)}h ({billableHours.toFixed(1)}h billable)
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
                  <div className="h-full rounded-full bg-blue-500" style={{ width: `${widthPct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </WidgetCard>
  );
}

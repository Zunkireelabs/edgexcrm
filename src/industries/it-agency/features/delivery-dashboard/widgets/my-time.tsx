"use client";

import { useWidgetData } from "@/industries/_shared/features/insights/lib/use-widget-data";
import { formatMoney } from "@/lib/travel/currency";
import { WidgetCard, WidgetLoading, WidgetEmpty, WidgetError } from "./widget-shell";
import type { DeliveryWidgetProps } from "./types";

interface SummaryRow {
  key: string;
  label: string;
  minutes: number;
  billable_minutes: number;
  billable_amount: number;
}

// Monday-Sunday range containing "now", in the browser's local timezone —
// good enough for a display widget (the source of truth for billing periods
// stays the tenant-timezone calc in /api/v1/resourcing/utilization).
function currentWeekRange(): { from: string; to: string } {
  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(monday), to: fmt(sunday) };
}

export default function MyTimeWidget({ currentUserId }: DeliveryWidgetProps) {
  const { from, to } = currentWeekRange();
  const { data: rows, loading, error } = useWidgetData<SummaryRow[]>(
    `/api/v1/time-entries/summary?dimension=member&from=${from}&to=${to}`
  );

  // No leak: the endpoint may return every member's row for an admin caller,
  // but only the row matching currentUserId is ever displayed.
  const mine = rows?.find((r) => r.key === currentUserId) ?? null;

  return (
    <WidgetCard title="My Time This Week">
      {loading ? (
        <WidgetLoading />
      ) : error ? (
        <WidgetError message="Failed to load your time entries." />
      ) : !mine ? (
        <WidgetEmpty message="No time logged this week." />
      ) : (
        <div className="space-y-1">
          <div className="text-3xl font-bold">{(mine.minutes / 60).toFixed(1)}h</div>
          <div className="text-xs text-muted-foreground">
            {(mine.billable_minutes / 60).toFixed(1)}h billable · {formatMoney(mine.billable_amount)}
          </div>
        </div>
      )}
    </WidgetCard>
  );
}

"use client";

import { useWidgetData } from "@/industries/_shared/features/insights/lib/use-widget-data";
import { WidgetCard, WidgetLoading, WidgetEmpty, WidgetError, RAG_COLORS } from "./widget-shell";
import type { DeliveryWidgetProps } from "./types";

interface UtilizationRow {
  tenant_user_id: string;
  billableHours: number;
  netCapacityHours: number;
  utilizationPct: number;
}

function barColor(pct: number): string {
  if (pct < 70) return RAG_COLORS.amber;
  if (pct <= 100) return RAG_COLORS.green;
  return RAG_COLORS.red;
}

export default function MyUtilizationWidget({ currentTenantUserId }: DeliveryWidgetProps) {
  const { data: rows, loading, error } = useWidgetData<UtilizationRow[]>("/api/v1/resourcing/utilization");

  // The endpoint self-scopes for non-admins but returns every member's row
  // for an admin — always filter client-side to my own row so an admin never
  // sees another user's utilization rendered inside this "My" widget.
  const mine = rows?.find((r) => r.tenant_user_id === currentTenantUserId) ?? null;

  return (
    <WidgetCard title="My Utilization">
      {loading ? (
        <WidgetLoading />
      ) : error ? (
        <WidgetError message="Failed to load utilization." />
      ) : !mine ? (
        <WidgetEmpty message="No utilization data yet." />
      ) : (
        <div className="space-y-2">
          <div className="text-3xl font-bold">{mine.utilizationPct}%</div>
          <div className="text-xs text-muted-foreground">
            {mine.billableHours.toFixed(1)}h / {mine.netCapacityHours.toFixed(1)}h
          </div>
          <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(mine.utilizationPct, 100)}%`,
                backgroundColor: barColor(mine.utilizationPct),
              }}
            />
          </div>
        </div>
      )}
    </WidgetCard>
  );
}

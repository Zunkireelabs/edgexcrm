"use client";

import { useWidgetData } from "@/industries/_shared/features/insights/lib/use-widget-data";
import { WidgetCard, WidgetLoading, WidgetEmpty, WidgetError } from "./widget-shell";

interface OwnerRow {
  user_id: string | null;
  count: number;
}

interface TeamMemberMinimal {
  user_id: string;
  name: string;
}

export default function SalesLeadsByOwnerWidget() {
  const { data, loading, error } = useWidgetData<OwnerRow[]>("/api/v1/insights/sales/leads-by-owner");
  const { data: team } = useWidgetData<TeamMemberMinimal[]>("/api/v1/team?minimal=1");

  function ownerName(userId: string | null): string {
    if (!userId) return "Unassigned";
    return team?.find((m) => m.user_id === userId)?.name ?? "Unknown";
  }

  return (
    <WidgetCard title="Leads by Owner">
      {loading ? (
        <WidgetLoading />
      ) : error ? (
        <WidgetError message="Failed to load leads by owner." />
      ) : !data || data.length === 0 ? (
        <WidgetEmpty message="No leads yet." />
      ) : (
        <div className="space-y-2">
          {data.map((r) => (
            <div key={r.user_id ?? "unassigned"} className="flex items-center justify-between border rounded-lg px-3 py-2">
              <span className="text-sm font-medium truncate">{ownerName(r.user_id)}</span>
              <span className="text-sm text-muted-foreground flex-shrink-0">{r.count}</span>
            </div>
          ))}
        </div>
      )}
    </WidgetCard>
  );
}

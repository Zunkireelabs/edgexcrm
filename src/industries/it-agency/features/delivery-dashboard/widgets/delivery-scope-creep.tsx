"use client";

import { useWidgetData } from "@/industries/_shared/features/insights/lib/use-widget-data";
import { formatMoney } from "@/lib/travel/currency";
import { WidgetCard, WidgetLoading, WidgetEmpty, WidgetError } from "./widget-shell";

interface ScopeCreep {
  proposed: number;
  approved: number;
  rejected: number;
  addedScopeMinutes: number;
  budgetDelta: number;
  currency: string;
}

export default function DeliveryScopeCreepWidget() {
  const { data, loading, error } = useWidgetData<ScopeCreep>("/api/v1/insights/delivery/scope-creep");

  const total = data ? data.proposed + data.approved + data.rejected : 0;

  return (
    <WidgetCard title="Scope-Creep Meter">
      {loading ? (
        <WidgetLoading />
      ) : error ? (
        <WidgetError message="Failed to load scope-creep data." />
      ) : !data || total === 0 ? (
        <WidgetEmpty message="No change requests yet." />
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Proposed" value={String(data.proposed)} />
          <Stat label="Approved" value={String(data.approved)} valueClassName="text-amber-600" />
          <Stat label="Added Scope" value={`${Math.round(data.addedScopeMinutes / 60)}h`} />
          <Stat label="Budget Delta" value={formatMoney(data.budgetDelta, data.currency)} />
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

"use client";

import { useWidgetData } from "@/industries/_shared/features/insights/lib/use-widget-data";
import { formatMoney } from "@/lib/travel/currency";
import { WidgetCard, WidgetLoading, WidgetEmpty, WidgetError } from "./widget-shell";

interface WinLoss {
  wonCount: number;
  lostCount: number;
  wonAmount: number;
  lostAmount: number;
  currency: string;
}

export default function SalesWinLossWidget() {
  const { data, loading, error } = useWidgetData<WinLoss>("/api/v1/insights/sales/win-loss");

  return (
    <WidgetCard title="Win / Loss">
      {loading ? (
        <WidgetLoading />
      ) : error ? (
        <WidgetError message="Failed to load win/loss." />
      ) : !data || data.wonCount + data.lostCount === 0 ? (
        <WidgetEmpty message="No closed deals yet." />
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Won" value={String(data.wonCount)} valueClassName="text-green-600" />
          <Stat label="Lost" value={String(data.lostCount)} valueClassName="text-red-600" />
          <Stat label="Won Value" value={formatMoney(data.wonAmount, data.currency)} />
          <Stat label="Lost Value" value={formatMoney(data.lostAmount, data.currency)} />
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

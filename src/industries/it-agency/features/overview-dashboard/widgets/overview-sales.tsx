"use client";

import { useWidgetData } from "@/industries/_shared/features/insights/lib/use-widget-data";
import { formatMoney } from "@/lib/travel/currency";
import { WidgetCard, WidgetLoading, WidgetEmpty, WidgetError, Stat } from "./widget-shell";

interface WeekPoint {
  week: string;
  count: number;
}

interface DealsSummary {
  winRatePct: number;
  weightedPipeline: number;
  bookingsWonMTD: number;
  currency: string;
}

// Bird's-eye sales tile row for Company Overview. No new fetch surface —
// reuses the same /api/v1/insights/sales/leads-trend and deals-summary
// endpoints the Sales & Outreach dashboard's widgets already call.
function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function newLeadsThisMonthVsLast(weeks: WeekPoint[]): { thisMonth: number; delta: number } {
  const now = new Date();
  const thisKey = monthKey(now);
  const lastKey = monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));

  const sums = new Map<string, number>();
  for (const w of weeks) {
    const key = monthKey(new Date(`${w.week}T00:00:00Z`));
    sums.set(key, (sums.get(key) ?? 0) + w.count);
  }

  const thisMonth = sums.get(thisKey) ?? 0;
  const lastMonth = sums.get(lastKey) ?? 0;
  return { thisMonth, delta: thisMonth - lastMonth };
}

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) return <span className="text-xs text-muted-foreground">flat</span>;
  const up = delta > 0;
  return (
    <span className={`text-xs font-medium ${up ? "text-green-600" : "text-red-600"}`}>
      {up ? "▲" : "▼"} {Math.abs(delta)}
    </span>
  );
}

export default function OverviewSalesWidget() {
  const { data: weeks, loading: weeksLoading, error: weeksError } = useWidgetData<WeekPoint[]>(
    "/api/v1/insights/sales/leads-trend"
  );
  const { data: deals, loading: dealsLoading, error: dealsError } = useWidgetData<DealsSummary>(
    "/api/v1/insights/sales/deals-summary"
  );

  const loading = weeksLoading || dealsLoading;
  const error = weeksError || dealsError;

  return (
    <WidgetCard title="Sales & Outreach">
      {loading ? (
        <WidgetLoading />
      ) : error ? (
        <WidgetError message="Failed to load sales overview." />
      ) : !weeks || !deals ? (
        <WidgetEmpty message="No sales data yet." />
      ) : (
        <OverviewSalesContent weeks={weeks} deals={deals} />
      )}
    </WidgetCard>
  );
}

function OverviewSalesContent({ weeks, deals }: { weeks: WeekPoint[]; deals: DealsSummary }) {
  const { thisMonth, delta } = newLeadsThisMonthVsLast(weeks);

  return (
    <div className="grid grid-cols-2 gap-4">
      <Stat label="New Leads (this month)" value={String(thisMonth)} delta={<DeltaBadge delta={delta} />} />
      <Stat label="Weighted Pipeline" value={formatMoney(deals.weightedPipeline, deals.currency)} />
      <Stat label="Win Rate" value={`${deals.winRatePct}%`} />
      <Stat label="Bookings Won (MTD)" value={formatMoney(deals.bookingsWonMTD, deals.currency)} />
    </div>
  );
}

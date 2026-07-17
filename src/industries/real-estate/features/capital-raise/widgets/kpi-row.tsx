"use client";

import { formatCurrency } from "@/industries/real-estate/lib/commitments";
import { WidgetCard } from "./widget-shell";
import type { CapitalRaiseSummary } from "../capital-raise-dashboard";

// KPI tile row — mirrors the `Stat` grid of the it_agency
// sales-deals-summary.tsx (Stat component copied below). All figures are across
// ALL offerings; money is rendered via the real_estate formatCurrency (NOT the
// travel formatMoney).
export function KpiRow({ data }: { data: CapitalRaiseSummary }) {
  const { currency } = data;
  return (
    <WidgetCard title="Capital Raised">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat
          label={`Equity Raised · ${data.pctRaised}% of target`}
          value={formatCurrency(data.totalRaised, currency)}
        />
        <Stat label="Target Raise" value={formatCurrency(data.totalTarget, currency)} />
        <Stat label="Funded (AUM)" value={formatCurrency(data.fundedTotal, currency)} />
        <Stat
          label={`Investors · Avg check ${formatCurrency(data.avgCheck, currency)}`}
          value={String(data.investorCount)}
        />
      </div>
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

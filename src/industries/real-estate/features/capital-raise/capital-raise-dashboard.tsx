"use client";

import { useWidgetData } from "@/industries/_shared/features/insights/lib/use-widget-data";
import type {
  CommitmentStatus,
  FunnelColumn,
  OfferingStatus,
} from "@/industries/real-estate/lib/commitments";
import { WidgetLoading, WidgetError, WidgetEmpty } from "./widgets/widget-shell";
import { KpiRow } from "./widgets/kpi-row";
import { OfferingsProgress } from "./widgets/offerings-progress";
import { RaiseFunnel } from "./widgets/raise-funnel";

// Capital-Raise Dashboard — the real_estate GP landing screen. One
// self-fetching round-trip (useWidgetData → /api/v1/insights/real-estate/summary)
// feeds three presentational widgets. Fixed layout (not a configurable
// dashboard). Mirrors the it_agency sales-dashboard composer by pattern, not by
// import.

// Matches the apiSuccess payload of GET /api/v1/insights/real-estate/summary.
export interface CapitalRaiseSummary {
  currency: string;
  totalRaised: number;
  totalTarget: number;
  pctRaised: number;
  fundedTotal: number;
  investorCount: number;
  avgCheck: number;
  activeOfferings: number;
  offerings: {
    id: string;
    name: string;
    status: OfferingStatus;
    raised: number;
    target: number;
    pct: number;
  }[];
  funnel: {
    status: FunnelColumn | CommitmentStatus;
    count: number;
    amount: number;
  }[];
}

export function CapitalRaiseDashboard() {
  const { data, loading, error } = useWidgetData<CapitalRaiseSummary>(
    "/api/v1/insights/real-estate/summary",
  );

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-bold">Capital Raise</h1>

      {loading ? (
        <WidgetLoading />
      ) : error ? (
        <WidgetError message="Failed to load the capital-raise summary." />
      ) : !data ? (
        <WidgetEmpty message="No capital-raise data yet." />
      ) : (
        <div className="space-y-6">
          <KpiRow data={data} />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <OfferingsProgress data={data} />
            <RaiseFunnel data={data} />
          </div>
        </div>
      )}
    </div>
  );
}

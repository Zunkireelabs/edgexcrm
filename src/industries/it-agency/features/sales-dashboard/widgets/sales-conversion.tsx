"use client";

import { useWidgetData } from "@/industries/_shared/features/insights/lib/use-widget-data";
import { WidgetCard, WidgetLoading, WidgetEmpty, WidgetError } from "./widget-shell";

interface StageRow {
  stage_id: string;
  name: string;
  sort_order: number;
  count: number;
}

// Stage Conversion — no new RPC, reuses the sales_funnel data (sales-funnel widget's
// endpoint) and derives step-down conversion % between consecutive stages client-side.
export default function SalesConversionWidget() {
  const { data, loading, error } = useWidgetData<StageRow[]>("/api/v1/insights/sales/funnel");

  const total = data?.reduce((sum, r) => sum + r.count, 0) ?? 0;

  return (
    <WidgetCard title="Stage Conversion">
      {loading ? (
        <WidgetLoading />
      ) : error ? (
        <WidgetError message="Failed to load stage conversion." />
      ) : !data || data.length === 0 ? (
        <WidgetEmpty message="No stages configured yet." />
      ) : total === 0 ? (
        <WidgetEmpty message="No leads in any stage yet." />
      ) : (
        <div className="space-y-2">
          {data.map((stage, i) => {
            const prev = i > 0 ? data[i - 1] : null;
            const pct = prev && prev.count > 0 ? Math.round((stage.count / prev.count) * 1000) / 10 : null;
            return (
              <div key={stage.stage_id} className="flex items-center justify-between border rounded-lg px-3 py-2">
                <span className="text-sm font-medium truncate">{stage.name}</span>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-sm text-muted-foreground">{stage.count}</span>
                  {pct !== null && (
                    <span className={`text-xs font-medium ${pct < 50 ? "text-red-600" : "text-green-600"}`}>
                      {pct}%
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </WidgetCard>
  );
}

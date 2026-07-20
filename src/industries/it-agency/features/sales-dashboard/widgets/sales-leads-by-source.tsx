"use client";

import { useWidgetData } from "@/industries/_shared/features/insights/lib/use-widget-data";
import { WidgetCard, WidgetLoading, WidgetEmpty, WidgetError } from "./widget-shell";

interface SourceRow {
  source: string;
  count: number;
}

export default function SalesLeadsBySourceWidget() {
  const { data, loading, error } = useWidgetData<SourceRow[]>("/api/v1/insights/sales/leads-by-source");

  return (
    <WidgetCard title="Leads by Source">
      {loading ? (
        <WidgetLoading />
      ) : error ? (
        <WidgetError message="Failed to load leads by source." />
      ) : !data || data.length === 0 ? (
        <WidgetEmpty message="No leads yet." />
      ) : (
        <SourceList rows={data} />
      )}
    </WidgetCard>
  );
}

function SourceList({ rows }: { rows: SourceRow[] }) {
  const total = rows.reduce((sum, r) => sum + r.count, 0) || 1;
  const top = rows.slice(0, 8);

  return (
    <div className="space-y-2.5">
      {top.map((r) => {
        const pct = (r.count / total) * 100;
        return (
          <div key={r.source} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium truncate">{r.source}</span>
              <span className="text-muted-foreground flex-shrink-0 ml-2">{r.count}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

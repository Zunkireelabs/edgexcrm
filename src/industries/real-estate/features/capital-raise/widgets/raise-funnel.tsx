"use client";

import {
  COMMITMENT_STATUS_LABELS,
  formatCurrency,
} from "@/industries/real-estate/lib/commitments";
import { WidgetCard, WidgetEmpty } from "./widget-shell";
import type { CapitalRaiseSummary } from "../capital-raise-dashboard";

// Raise funnel across ALL offerings combined: the 4 FUNNEL_COLUMNS
// (prospect → soft_commit → subscribed → funded), each a CSS bar showing the
// commitment count and $ total. `declined` is off-funnel (already excluded
// server-side). `funnel` arrives in FUNNEL_COLUMNS order.
const COLORS = ["#3b82f6", "#6366f1", "#8b5cf6", "#22c55e"];

export function RaiseFunnel({ data }: { data: CapitalRaiseSummary }) {
  const { funnel, currency } = data;
  const maxCount = Math.max(1, ...funnel.map((f) => f.count));
  const total = funnel.reduce((s, f) => s + f.count, 0);

  return (
    <WidgetCard title="Raise Funnel">
      {total === 0 ? (
        <WidgetEmpty message="No commitments yet." />
      ) : (
        <div className="grid grid-cols-4 gap-3 items-end h-[240px]">
          {funnel.map((f, i) => (
            <div key={f.status} className="flex flex-col items-center justify-end gap-2 h-full">
              <span className="text-sm font-bold">{f.count}</span>
              <div
                className="w-full rounded-t"
                style={{
                  height: `${Math.max((f.count / maxCount) * 160, 4)}px`,
                  backgroundColor: COLORS[i % COLORS.length],
                }}
              />
              <div className="text-center space-y-0.5">
                <div className="text-xs font-medium">{COMMITMENT_STATUS_LABELS[f.status]}</div>
                <div className="text-[11px] text-muted-foreground">
                  {formatCurrency(f.amount, currency)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </WidgetCard>
  );
}

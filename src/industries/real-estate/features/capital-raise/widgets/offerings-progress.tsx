"use client";

import { Badge } from "@/components/ui/badge";
import { formatCurrency, type OfferingStatus } from "@/industries/real-estate/lib/commitments";
import { WidgetCard, WidgetEmpty } from "./widget-shell";
import type { CapitalRaiseSummary } from "../capital-raise-dashboard";

// One row per offering: name · raised / target · progress bar · status badge.
// This is the "equity-raised-vs-target across offerings" the pitch centers on.
const STATUS_LABELS: Record<OfferingStatus, string> = {
  draft: "Draft",
  raising: "Raising",
  closed: "Closed",
  funded: "Funded",
  paused: "Paused",
};

const STATUS_VARIANT: Record<OfferingStatus, "default" | "secondary" | "outline"> = {
  draft: "outline",
  raising: "default",
  closed: "secondary",
  funded: "default",
  paused: "secondary",
};

export function OfferingsProgress({ data }: { data: CapitalRaiseSummary }) {
  const { offerings, currency } = data;
  return (
    <WidgetCard title="Offerings">
      {offerings.length === 0 ? (
        <WidgetEmpty message="No offerings yet." />
      ) : (
        <div className="space-y-5">
          {offerings.map((o) => (
            <div key={o.id} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium truncate">{o.name}</span>
                <Badge variant={STATUS_VARIANT[o.status] ?? "outline"}>
                  {STATUS_LABELS[o.status] ?? o.status}
                </Badge>
              </div>
              <div className="h-2 rounded bg-muted overflow-hidden">
                <div
                  className="h-full rounded bg-primary"
                  style={{ width: `${Math.min(o.pct, 100)}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {formatCurrency(o.raised, currency)} / {formatCurrency(o.target, currency)}
                </span>
                <span>{o.pct}%</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </WidgetCard>
  );
}

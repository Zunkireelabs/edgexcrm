"use client";

import { useWidgetData } from "@/industries/_shared/features/insights/lib/use-widget-data";
import { WidgetCard, WidgetLoading, WidgetError } from "./widget-shell";

interface CoverageData {
  total: number;
  assigned: number;
  unassigned: number;
  coveragePct: number;
}

// Standing health metric — window-independent, muted styling (steady-state, not
// an alert, per the approved UI plan: coverage never uses warning/destructive).
export default function EduCoverageMeterWidget() {
  const { data, loading, error } = useWidgetData<CoverageData>("/api/v1/insights/education/coverage");

  return (
    <WidgetCard title="Coverage">
      {loading ? (
        <WidgetLoading />
      ) : error || !data ? (
        <WidgetError />
      ) : (
        <div className="flex items-baseline justify-between">
          <div>
            <p className="text-3xl font-semibold text-foreground">{data.coveragePct}%</p>
            <p className="text-sm text-muted-foreground">of active-pipeline leads have a live assignee</p>
          </div>
          <p className="text-sm text-muted-foreground">Unassigned: {data.unassigned}</p>
        </div>
      )}
    </WidgetCard>
  );
}

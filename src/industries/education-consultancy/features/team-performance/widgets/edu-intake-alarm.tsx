"use client";

import { Badge } from "@/components/ui/badge";
import { useWidgetData } from "@/industries/_shared/features/insights/lib/use-widget-data";
import { WidgetCard, WidgetLoading, WidgetEmpty, WidgetError } from "./widget-shell";
import type { IntakeAlarmRow, IdleStaffRow } from "../lib/types";

interface IntakeAlarmData {
  buckets: IntakeAlarmRow[];
  idleStaff: IdleStaffRow[];
}

function bucketVariant(bucket: string): "secondary" | "warning" | "destructive" {
  if (bucket.endsWith("+")) return "destructive";
  if (bucket.includes("-")) return "warning";
  return "secondary";
}

// Two alarm strips: (a) Pre-qualified leads not yet touched, bucketed by age;
// (b) staff who touched zero leads in the last 24h — an idle/absent-staffer
// flag, distinct from "this one lead is stuck". Labeled "No CRM Activity",
// never "Staff Idle" — exact wording locked by the approved UI plan.
export default function EduIntakeAlarmWidget() {
  const { data, loading, error } = useWidgetData<IntakeAlarmData>("/api/v1/insights/education/intake-alarm");

  return (
    <WidgetCard title="Needs Attention Now">
      {loading ? (
        <WidgetLoading />
      ) : error || !data ? (
        <WidgetError />
      ) : (
        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Pre-qualified, untouched</p>
            {data.buckets.length === 0 ? (
              <WidgetEmpty message="Nothing untouched right now." />
            ) : (
              <div className="flex gap-2">
                {data.buckets.map((b) => (
                  <Badge key={b.bucket} variant={bucketVariant(b.bucket)}>
                    {b.bucket}: {b.cnt}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">No CRM Activity (last 24h)</p>
            {data.idleStaff.length === 0 ? (
              <WidgetEmpty message="Everyone logged activity in the last 24h." />
            ) : (
              <div className="flex flex-wrap gap-2">
                {data.idleStaff.map((s) => (
                  <Badge key={s.user_id} variant="warning">
                    {s.user_email}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </WidgetCard>
  );
}

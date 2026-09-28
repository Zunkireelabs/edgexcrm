"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { useWidgetData } from "@/industries/_shared/features/insights/lib/use-widget-data";
import { WidgetCard, WidgetLoading, WidgetEmpty, WidgetError } from "./widget-shell";
import type { IntakeAlarmBucket, IdleStaffRow } from "../lib/types";

interface IntakeAlarmData {
  buckets: IntakeAlarmBucket[];
  listName: string | null;
  listSlug: string | null;
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Both "Needs Attention Now" and "The Pipeline" always render on the same
  // Team & Lead Performance dashboard page — deep-link by pushing new search
  // params onto the current pathname rather than needing a separate dashboard
  // URL. Preserves window/branch/team; clears every Pipeline drill param
  // (stage/position/person/jump) per the URL-state invalidation rule so the
  // link always lands on a fresh, valid drill state.
  function deepLink(next: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of ["stage", "position", "person", "jump"]) params.delete(key);
    for (const [k, v] of Object.entries(next)) params.set(k, v);
    router.push(`${pathname}?${params.toString()}`);
  }

  const intakeListName = data?.listName ?? "Intake list not configured";

  return (
    <WidgetCard title="Needs Attention Now">
      {loading ? (
        <WidgetLoading />
      ) : error || !data ? (
        <WidgetError />
      ) : (
        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">{intakeListName}, untouched</p>
            {data.buckets.length === 0 ? (
              <WidgetEmpty message="Nothing untouched right now." />
            ) : (
              <div className="flex gap-2">
                {data.buckets.map((b) => (
                  <button
                    key={b.bucket}
                    type="button"
                    disabled={!data.listSlug}
                    onClick={() => data.listSlug && deepLink({ stage: data.listSlug })}
                    className="disabled:cursor-default"
                  >
                    <Badge variant={bucketVariant(b.bucket)} className={data.listSlug ? "cursor-pointer hover:opacity-80" : undefined}>
                      {b.bucket}: {b.cnt}
                    </Badge>
                  </button>
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
                  <button key={s.user_id} type="button" onClick={() => deepLink({ jump: s.user_id })}>
                    <Badge variant="warning" className="cursor-pointer hover:opacity-80">
                      {s.user_email}
                    </Badge>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </WidgetCard>
  );
}

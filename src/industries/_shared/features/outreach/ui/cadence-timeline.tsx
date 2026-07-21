"use client";

import { useState, useCallback } from "react";
import { CheckCircle2, SkipForward, Clock, CalendarClock, Eye, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DraftReviewPanel } from "./draft-review-panel";
import type { Draft } from "./today-worklist";
import { useCadence, type CadenceStepItem } from "../hooks/use-cadence";
import { formatDate } from "../lib/format-due";
import type { LeadActivityRecord } from "@/types/database";

interface CadenceTimelineProps {
  enrollmentId: string;
  enrollmentStatus: "active" | "paused" | "completed" | "unenrolled";
  leadId: string;
  leadFirstName: string | null;
  leadLastName: string | null;
  leadEmail: string | null;
  sequenceName: string;
  canAct: boolean;
  onChanged: () => void;
}

/** Sent-step preview — lazily loads the lead's logged emails once, then reads from the cache by id. */
function SentPreview({ leadId, activityId }: { leadId: string; activityId: string }) {
  const [activities, setActivities] = useState<Map<string, LeadActivityRecord> | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (activities || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/activities?type=email`);
      if (res.ok) {
        const json = await res.json();
        const rows = (json.data ?? []) as LeadActivityRecord[];
        setActivities(new Map(rows.map((a) => [a.id, a])));
      }
    } finally {
      setLoading(false);
    }
  }, [leadId, activities, loading]);

  const activity = activities?.get(activityId);

  return (
    <Popover onOpenChange={(open) => open && load()}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="shrink-0 min-h-11 flex items-center gap-1 px-2 py-1 text-xs text-primary hover:underline"
          aria-label="View sent email in timeline"
          onClick={(e) => e.stopPropagation()}
        >
          <Eye className="h-3.5 w-3.5" /> View in timeline
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-sm" align="end">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : activity ? (
          <div className="space-y-1.5">
            <p className="font-medium">{activity.email_subject || activity.subject || "Email"}</p>
            <p className="text-xs text-muted-foreground">Sent {formatDate(activity.created_at)}</p>
            {activity.email_body && (
              <div
                className="prose prose-sm max-w-none text-xs text-muted-foreground max-h-40 overflow-y-auto"
                dangerouslySetInnerHTML={{ __html: activity.email_body }}
              />
            )}
          </div>
        ) : (
          <p className="text-muted-foreground">Activity not found — it may have been deleted.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function CadenceTimeline({
  enrollmentId,
  enrollmentStatus,
  leadId,
  leadFirstName,
  leadLastName,
  leadEmail,
  sequenceName,
  canAct,
  onChanged,
}: CadenceTimelineProps) {
  const { data, loading, refresh } = useCadence(enrollmentId);
  const [activeDraft, setActiveDraft] = useState<Draft | null>(null);

  const openDue = (item: CadenceStepItem) => {
    if (!canAct || enrollmentStatus !== "active" || item.state !== "pending" || !item.draft_id) return;
    setActiveDraft({
      id: item.draft_id,
      lead_id: leadId,
      step_order: item.step_order,
      due_at: item.due_at ?? new Date().toISOString(),
      subject: item.subject,
      body_html: item.body_html ?? "",
      status: "pending",
      leads: { first_name: leadFirstName, last_name: leadLastName, email: leadEmail },
      sequence_enrollments: { sequence_id: "", status: enrollmentStatus, email_sequences: { name: sequenceName } },
    });
  };

  const handleDone = (_draftId: string) => {
    setActiveDraft(null);
    refresh();
    onChanged();
  };

  if (loading && !data) {
    return <p className="text-xs text-muted-foreground px-1 py-2">Loading cadence...</p>;
  }
  if (!data || data.timeline.length === 0) return null;

  return (
    <div className="rounded-lg border divide-y" role="list" aria-label={`${sequenceName} cadence timeline`}>
      {data.timeline.map((item) => {
        const isSent = item.state === "sent";
        const isSkipped = item.state === "skipped";
        const isDue = item.state === "pending" && !!item.due_at && new Date(item.due_at) <= new Date();
        const isScheduled = item.state === "pending" && !isDue;
        const isProjected = item.state === "projected";
        const clickable = isDue && canAct && enrollmentStatus === "active";

        const statusLabel = isSent
          ? `Sent ${formatDate(item.sent_at ?? "")}`
          : isSkipped
            ? "Skipped"
            : isDue
              ? enrollmentStatus === "paused"
                ? "Due now · paused"
                : "Due now"
              : isScheduled
                ? `Due ${formatDate(item.due_at ?? "")}`
                : `~${formatDate(item.projected_due_at ?? "")} · projected`;

        const rowInner = (
          <>
            <div className="shrink-0" aria-hidden>
              {isSent && <CheckCircle2 className="h-4 w-4 text-green-600" />}
              {isSkipped && <SkipForward className="h-4 w-4 text-muted-foreground" />}
              {isDue && <Clock className="h-4 w-4 text-amber-600" />}
              {(isScheduled || isProjected) && <CalendarClock className="h-4 w-4 text-muted-foreground" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground shrink-0">Step {item.step_order}</span>
                <span className={`text-sm truncate ${isSkipped ? "line-through text-muted-foreground" : ""}`}>
                  {item.subject || "(no subject)"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{statusLabel}</p>
            </div>
            {isSent && item.sent_activity_id && <SentPreview leadId={leadId} activityId={item.sent_activity_id} />}
          </>
        );

        if (clickable) {
          return (
            <button
              key={item.step_order}
              type="button"
              role="listitem"
              onClick={() => openDue(item)}
              className="w-full flex items-center gap-3 px-3 py-2.5 min-h-11 text-left bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/30 dark:hover:bg-amber-950/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Step ${item.step_order} due now — open to review and send`}
            >
              {rowInner}
            </button>
          );
        }

        return (
          <div
            key={item.step_order}
            role="listitem"
            tabIndex={0}
            className={`flex items-center gap-3 px-3 py-2.5 min-h-11 ${
              isProjected || isScheduled || isSkipped ? "opacity-70" : ""
            }`}
            aria-label={`Step ${item.step_order} — ${statusLabel}`}
          >
            {rowInner}
          </div>
        );
      })}

      <DraftReviewPanel
        draft={activeDraft}
        onOpenChange={(open) => !open && setActiveDraft(null)}
        onSent={handleDone}
        onSkipped={handleDone}
      />
    </div>
  );
}

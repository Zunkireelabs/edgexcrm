"use client";

import type { LeadActivity } from "@/lib/supabase/queries";

interface ApplicationActivityTimelineProps {
  timeline: LeadActivity[];
  teamMemberEmails: Record<string, string>;
}

function getDescription(activity: LeadActivity, teamEmails: Record<string, string>): string {
  const changes = activity.changes || {};

  if (activity.action === "application.created") return "Application created";

  if (activity.action === "application.deleted") return "Application deleted";

  if (activity.action === "application.stage_changed") {
    const newStage = changes.patch?.new as Record<string, unknown> | null;
    if (newStage?.status) return `Stage changed to "${newStage.status}"`;
    return "Stage changed";
  }

  if (activity.action === "application.updated") {
    const patch = changes.patch?.new as Record<string, unknown> | null;
    if (!patch) return "Application updated";
    const fields = Object.keys(patch).filter((k) => k !== "updated_at");
    if (fields.length === 0) return "Application updated";
    if (fields.length === 1) {
      const label = FIELD_LABELS[fields[0]] ?? fields[0].replace(/_/g, " ");
      return `Updated ${label}`;
    }
    return `Updated ${fields.length} fields`;
  }

  const userEmail = activity.user_id ? teamEmails[activity.user_id] : null;
  void userEmail;
  return activity.action.replace("application.", "").replace(/_/g, " ");
}

const FIELD_LABELS: Record<string, string> = {
  university_name: "university",
  program_name: "program",
  intake_term: "intake term",
  country: "country",
  offer_type: "offer type",
  offer_letter_url: "offer letter URL",
  application_deadline: "deadline",
  application_fee_paid: "application fee",
  tuition_fee: "tuition fee",
  deposit_paid: "deposit",
  notes: "notes",
  assigned_to: "assignee",
};

function formatTime(dateString: string): string {
  const date = new Date(dateString);
  const isCurrentYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(isCurrentYear ? {} : { year: "numeric" }),
  });
}

export function ApplicationActivityTimeline({
  timeline,
  teamMemberEmails,
}: ApplicationActivityTimelineProps) {
  if (timeline.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6">
        No activity recorded yet.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {timeline.map((activity) => {
        const description = getDescription(activity, teamMemberEmails);
        const userEmail = activity.user_id ? teamMemberEmails[activity.user_id] : null;
        const isStageChange = activity.action === "application.stage_changed";

        return (
          <div key={activity.id} className="flex items-start gap-2 py-1 text-sm">
            <div
              className={`h-2 w-2 rounded-full shrink-0 mt-1.5 ${
                isStageChange ? "bg-primary" : "bg-gray-300"
              }`}
            />
            <div className="flex-1 min-w-0">
              <span className="text-foreground">{description}</span>
              <span className="text-muted-foreground mx-1">·</span>
              <span className="text-muted-foreground">{formatTime(activity.created_at)}</span>
              {userEmail && (
                <>
                  <span className="text-muted-foreground mx-1">·</span>
                  <span className="text-muted-foreground truncate">{userEmail}</span>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

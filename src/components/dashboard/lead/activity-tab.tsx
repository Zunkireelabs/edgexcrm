"use client";

import {
  GitBranch,
  UserPlus,
  FileText,
  CheckSquare,
  Plus,
  Edit,
  Trash2,
  Clock,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { LeadActivity } from "@/lib/supabase/queries";

interface ActivityTabProps {
  activities: LeadActivity[];
  teamMemberEmails: Record<string, string>;
}

export function ActivityTab({ activities, teamMemberEmails }: ActivityTabProps) {
  if (activities.length === 0) {
    return (
      <Card className="shadow-none rounded-lg py-0">
        <CardContent className="p-8 text-center">
          <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-muted-foreground">No activity yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Actions like stage changes and assignments will appear here
          </p>
        </CardContent>
      </Card>
    );
  }

  // Group activities by date
  const groupedActivities = groupByDate(activities);

  return (
    <div className="space-y-6">
      {Object.entries(groupedActivities).map(([dateLabel, dayActivities]) => (
        <div key={dateLabel}>
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
            {dateLabel}
          </h3>
          <div className="space-y-3">
            {dayActivities.map((activity) => (
              <ActivityItem
                key={activity.id}
                activity={activity}
                teamMemberEmails={teamMemberEmails}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ActivityItem({
  activity,
  teamMemberEmails,
}: {
  activity: LeadActivity;
  teamMemberEmails: Record<string, string>;
}) {
  const { icon, color, description } = getActivityDisplay(activity, teamMemberEmails);
  const time = new Date(activity.created_at).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  const userEmail = activity.user_id ? teamMemberEmails[activity.user_id] : null;

  return (
    <Card className="shadow-none rounded-lg py-0">
      <CardContent className="p-3">
        <div className="flex gap-3">
          <div
            className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${color}`}
          >
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-foreground">{description}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-muted-foreground">{time}</span>
              {userEmail && (
                <>
                  <span className="text-xs text-muted-foreground">•</span>
                  <span className="text-xs text-muted-foreground truncate">
                    {userEmail}
                  </span>
                </>
              )}
            </div>
            {/* Show changes details for certain actions */}
            {activity.changes && Object.keys(activity.changes).length > 0 && (
              <ChangesDisplay changes={activity.changes} />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ChangesDisplay({
  changes,
}: {
  changes: Record<string, { old: unknown; new: unknown }>;
}) {
  const displayableChanges = Object.entries(changes).filter(([key]) => {
    // Skip internal fields
    return !["updated_at", "id", "tenant_id", "session_id"].includes(key);
  });

  if (displayableChanges.length === 0) return null;

  return (
    <div className="mt-2 text-xs space-y-1">
      {displayableChanges.slice(0, 3).map(([key, { old: oldVal, new: newVal }]) => (
        <div key={key} className="flex items-center gap-2 text-muted-foreground">
          <span className="capitalize">{formatFieldName(key)}:</span>
          {oldVal !== null && oldVal !== undefined && (
            <>
              <span className="line-through">{formatValue(oldVal)}</span>
              <span>→</span>
            </>
          )}
          <span className="text-foreground">{formatValue(newVal)}</span>
        </div>
      ))}
      {displayableChanges.length > 3 && (
        <p className="text-muted-foreground">
          +{displayableChanges.length - 3} more changes
        </p>
      )}
    </div>
  );
}

// Helper functions
function getActivityDisplay(
  activity: LeadActivity,
  teamMemberEmails: Record<string, string>
): {
  icon: React.ReactNode;
  color: string;
  description: string;
} {
  const action = activity.action.toLowerCase();
  const changes = activity.changes || {};

  // Stage change
  if (changes.status || changes.stage_id) {
    const newStatus = changes.status?.new || changes.stage_id?.new;
    return {
      icon: <GitBranch className="h-4 w-4" />,
      color: "bg-blue-100 text-blue-600",
      description: `Stage changed to "${formatValue(newStatus)}"`,
    };
  }

  // Assignment change
  if (changes.assigned_to) {
    const newAssignee = changes.assigned_to.new;
    const assigneeEmail = newAssignee ? teamMemberEmails[String(newAssignee)] : null;
    if (newAssignee) {
      return {
        icon: <UserPlus className="h-4 w-4" />,
        color: "bg-purple-100 text-purple-600",
        description: `Assigned to ${assigneeEmail || "a team member"}`,
      };
    } else {
      return {
        icon: <UserPlus className="h-4 w-4" />,
        color: "bg-gray-100 text-gray-600",
        description: "Unassigned",
      };
    }
  }

  // Lead created
  if (action === "create" || action === "created") {
    return {
      icon: <Plus className="h-4 w-4" />,
      color: "bg-green-100 text-green-600",
      description: "Lead created",
    };
  }

  // Lead updated
  if (action === "update" || action === "updated") {
    return {
      icon: <Edit className="h-4 w-4" />,
      color: "bg-amber-100 text-amber-600",
      description: "Lead updated",
    };
  }

  // Lead deleted
  if (action === "delete" || action === "deleted") {
    return {
      icon: <Trash2 className="h-4 w-4" />,
      color: "bg-red-100 text-red-600",
      description: "Lead deleted",
    };
  }

  // Checklist related
  if (activity.entity_type === "checklist" || action.includes("checklist")) {
    return {
      icon: <CheckSquare className="h-4 w-4" />,
      color: "bg-teal-100 text-teal-600",
      description: `Checklist ${action}`,
    };
  }

  // Note related
  if (activity.entity_type === "note" || action.includes("note")) {
    return {
      icon: <FileText className="h-4 w-4" />,
      color: "bg-indigo-100 text-indigo-600",
      description: `Note ${action}`,
    };
  }

  // Default
  return {
    icon: <Clock className="h-4 w-4" />,
    color: "bg-gray-100 text-gray-600",
    description: `${activity.action} ${activity.entity_type}`,
  };
}

function groupByDate(
  activities: LeadActivity[]
): Record<string, LeadActivity[]> {
  const groups: Record<string, LeadActivity[]> = {};
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  for (const activity of activities) {
    const date = new Date(activity.created_at);
    date.setHours(0, 0, 0, 0);

    let label: string;
    if (date.getTime() === today.getTime()) {
      label = "Today";
    } else if (date.getTime() === yesterday.getTime()) {
      label = "Yesterday";
    } else {
      label = date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
      });
    }

    if (!groups[label]) {
      groups[label] = [];
    }
    groups[label].push(activity);
  }

  return groups;
}

function formatFieldName(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

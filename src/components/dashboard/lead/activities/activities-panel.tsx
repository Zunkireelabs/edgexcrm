"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Phone, Mail, Calendar, Clock, FileText, CheckSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import type { LeadActivityRecord, ActivityType, LeadNote } from "@/types/database";
import type { LeadActivity } from "@/lib/supabase/queries";
import { ActivityCard } from "./activity-card";
import { LogActivityModal } from "./log-activity-modal";

type SubTab = "all" | "notes" | "emails" | "calls" | "tasks" | "meetings";

interface ActivitiesPanelProps {
  leadId: string;
  notes: LeadNote[];
  systemActivities: LeadActivity[];
  teamMemberEmails: Record<string, string>;
  isAdmin: boolean;
  onNotesChange: (notes: LeadNote[]) => void;
  currentUserId: string;
}

const SUB_TABS: { id: SubTab; label: string; icon: React.ReactNode }[] = [
  { id: "all", label: "Activity", icon: <Clock className="h-4 w-4" /> },
  { id: "notes", label: "Notes", icon: <FileText className="h-4 w-4" /> },
  { id: "emails", label: "Emails", icon: <Mail className="h-4 w-4" /> },
  { id: "calls", label: "Calls", icon: <Phone className="h-4 w-4" /> },
  { id: "tasks", label: "Tasks", icon: <CheckSquare className="h-4 w-4" /> },
  { id: "meetings", label: "Meetings", icon: <Calendar className="h-4 w-4" /> },
];

export function ActivitiesPanel({
  leadId,
  notes,
  systemActivities,
  teamMemberEmails,
  isAdmin,
  currentUserId,
}: ActivitiesPanelProps) {
  const [activeTab, setActiveTab] = useState<SubTab>("all");
  const [loggedActivities, setLoggedActivities] = useState<LeadActivityRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState<ActivityType>("call");

  // Fetch logged activities
  const fetchActivities = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/activities`);
      if (res.ok) {
        const json = await res.json();
        setLoggedActivities(json.data || []);
      }
    } catch {
      console.error("Failed to fetch activities");
    } finally {
      setIsLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  const handleLogActivity = (type: ActivityType) => {
    setModalType(type);
    setModalOpen(true);
  };

  const handleActivityLogged = (activity: LeadActivityRecord) => {
    setLoggedActivities((prev) => [activity, ...prev]);
  };

  const handleDeleteActivity = async (activityId: string) => {
    if (!confirm("Delete this activity?")) return;

    try {
      const res = await fetch(`/api/v1/leads/${leadId}/activities/${activityId}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error();

      setLoggedActivities((prev) => prev.filter((a) => a.id !== activityId));
      toast.success("Activity deleted");
    } catch {
      toast.error("Failed to delete activity");
    }
  };

  // Filter activities by type
  const filteredActivities = useMemo(() => {
    if (activeTab === "all") return loggedActivities;
    if (activeTab === "calls") return loggedActivities.filter((a) => a.activity_type === "call");
    if (activeTab === "emails") return loggedActivities.filter((a) => a.activity_type === "email");
    if (activeTab === "meetings") return loggedActivities.filter((a) => a.activity_type === "meeting");
    return [];
  }, [loggedActivities, activeTab]);

  // Group by date
  const groupedActivities = useMemo(() => {
    const groups: Record<string, LeadActivityRecord[]> = {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const activity of filteredActivities) {
      const date = new Date(activity.created_at);
      const dateKey = date.toLocaleDateString("en-US", { month: "long", year: "numeric" });

      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(activity);
    }

    return groups;
  }, [filteredActivities]);

  // Get action buttons based on active tab
  const getActionButtons = () => {
    switch (activeTab) {
      case "calls":
        return (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => handleLogActivity("call")}>
              Log Call
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={`tel:`}>Make a phone call</a>
            </Button>
          </div>
        );
      case "emails":
        return (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => handleLogActivity("email")}>
              Log Email
            </Button>
          </div>
        );
      case "meetings":
        return (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => handleLogActivity("meeting")}>
              Log Meeting
            </Button>
          </div>
        );
      default:
        return null;
    }
  };

  // Get empty state message
  const getEmptyMessage = () => {
    switch (activeTab) {
      case "calls":
        return "Call a contact from this record. Or log a call activity to keep track of your discussion and notes.";
      case "emails":
        return "Log emails to keep track of your communication with this lead.";
      case "meetings":
        return "Schedule a meeting with a contact from this record. Or log a meeting activity to keep track of your meeting and notes.";
      case "notes":
        return "No notes yet. Add a note to keep track of important information.";
      case "tasks":
        return "No tasks yet. Use the checklist panel to add tasks.";
      case "all":
        return "No activities yet. Log calls, emails, or meetings to track your interactions.";
      default:
        return "No activities yet.";
    }
  };

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="border-b">
        <div className="flex gap-1 -mb-px overflow-x-auto">
          {SUB_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Action buttons */}
      {(activeTab === "calls" || activeTab === "emails" || activeTab === "meetings") && (
        <div className="flex justify-end">
          {getActionButtons()}
        </div>
      )}

      {/* Notes tab - show existing notes functionality */}
      {activeTab === "notes" && (
        <Card className="shadow-none rounded-lg py-0">
          <CardContent className="p-4">
            {notes.length > 0 ? (
              <div className="space-y-3">
                {notes.map((note) => (
                  <div key={note.id} className="border-l-2 border-muted pl-3 py-1">
                    <p className="text-sm text-foreground">{note.content}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {note.user_email} · {formatRelativeTime(note.created_at)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                {getEmptyMessage()}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tasks tab - point to checklist */}
      {activeTab === "tasks" && (
        <Card className="shadow-none rounded-lg py-0">
          <CardContent className="p-8 text-center">
            <CheckSquare className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground">
              Tasks are managed in the Checklist panel on the right.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Activity list (all, calls, emails, meetings) */}
      {(activeTab === "all" || activeTab === "calls" || activeTab === "emails" || activeTab === "meetings") && (
        <>
          {isLoading ? (
            <Card className="shadow-none rounded-lg py-0">
              <CardContent className="p-8 text-center">
                <p className="text-muted-foreground">Loading activities...</p>
              </CardContent>
            </Card>
          ) : filteredActivities.length === 0 ? (
            <Card className="shadow-none rounded-lg py-0">
              <CardContent className="p-8 text-center">
                <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-muted-foreground">{getEmptyMessage()}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {Object.entries(groupedActivities).map(([dateLabel, activities]) => (
                <div key={dateLabel}>
                  <h3 className="text-sm font-medium text-muted-foreground mb-3">
                    {dateLabel}
                  </h3>
                  <div className="space-y-2">
                    {activities.map((activity) => (
                      <ActivityCard
                        key={activity.id}
                        activity={activity}
                        onDelete={handleDeleteActivity}
                        canDelete={isAdmin || activity.user_id === currentUserId}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Also show system activities on "all" tab */}
          {activeTab === "all" && systemActivities.length > 0 && (
            <div className="mt-6 pt-4 border-t">
              <h3 className="text-sm font-medium text-muted-foreground mb-3">System Activity</h3>
              <div className="space-y-2">
                {systemActivities.slice(0, 5).map((activity) => (
                  <SystemActivityItem
                    key={activity.id}
                    activity={activity}
                    teamMemberEmails={teamMemberEmails}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Log Activity Modal */}
      <LogActivityModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        leadId={leadId}
        activityType={modalType}
        onActivityLogged={handleActivityLogged}
      />
    </div>
  );
}

// System activity item (for stage changes, etc.)
function SystemActivityItem({
  activity,
  teamMemberEmails,
}: {
  activity: LeadActivity;
  teamMemberEmails: Record<string, string>;
}) {
  const time = new Date(activity.created_at).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  const userEmail = activity.user_id ? teamMemberEmails[activity.user_id] : null;
  const description = getSystemActivityDescription(activity, teamMemberEmails);

  return (
    <div className="flex items-center gap-2 text-sm py-1">
      <div className="h-2 w-2 rounded-full bg-gray-300" />
      <span className="text-foreground">{description}</span>
      <span className="text-muted-foreground">· {time}</span>
      {userEmail && <span className="text-muted-foreground">· {userEmail}</span>}
    </div>
  );
}

function getSystemActivityDescription(
  activity: LeadActivity,
  teamMemberEmails: Record<string, string>
): string {
  const changes = activity.changes || {};

  if (changes.status || changes.stage_id) {
    const newStatus = changes.status?.new || changes.stage_id?.new;
    return `Stage changed to "${newStatus}"`;
  }

  if (changes.assigned_to) {
    const newAssignee = changes.assigned_to.new;
    const assigneeEmail = newAssignee ? teamMemberEmails[String(newAssignee)] : null;
    if (newAssignee) {
      return `Assigned to ${assigneeEmail || "a team member"}`;
    }
    return "Unassigned";
  }

  return `${activity.action} ${activity.entity_type}`;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours === 0) {
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      return diffMinutes <= 1 ? "Just now" : `${diffMinutes}m ago`;
    }
    return `${diffHours}h ago`;
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

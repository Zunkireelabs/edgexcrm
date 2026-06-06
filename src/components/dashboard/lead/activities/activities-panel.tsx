"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import { Phone, Mail, Calendar, Clock, FileText, CheckSquare, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import type { LeadSubmission } from "@/types/database";
import { toast } from "sonner";
import type { LeadActivityRecord, ActivityType, LeadNote } from "@/types/database";
import type { LeadActivity } from "@/lib/supabase/queries";
import { ActivityCard } from "./activity-card";
import { LogActivityModal } from "./log-activity-modal";
import { type EmailThread, type Email } from "@/industries/education-consultancy/features/email/hooks/use-email-threads";
import { useConnectedInboxes } from "@/industries/education-consultancy/features/email/hooks/use-connected-inboxes";

// Lazy-load compose dialog so TipTap only loads when the modal is opened
const ComposeEmailDialog = dynamic(
  () =>
    import(
      "@/industries/education-consultancy/features/email/components/compose-email-dialog"
    ).then((m) => m.ComposeEmailDialog),
  { ssr: false },
);

// Lazy-load thread card
const EmailThreadCard = dynamic(
  () =>
    import(
      "@/industries/education-consultancy/features/email/components/email-thread-card"
    ).then((m) => m.EmailThreadCard),
  { ssr: false },
);

type SubTab = "all" | "notes" | "emails" | "calls" | "tasks" | "meetings";

interface ActivitiesPanelProps {
  leadId: string;
  notes: LeadNote[];
  systemActivities: LeadActivity[];
  teamMemberEmails: Record<string, string>;
  isAdmin: boolean;
  onNotesChange: (notes: LeadNote[]) => void;
  currentUserId: string;
  industryId?: string | null;
  leadEmail?: string | null;
  leadFirstName?: string | null;
  leadLastName?: string | null;
  threads: EmailThread[];
  setThreads: React.Dispatch<React.SetStateAction<EmailThread[]>>;
  threadsLoading: boolean;
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
  industryId,
  leadEmail,
  leadFirstName,
  leadLastName,
  threads,
  setThreads,
  threadsLoading,
}: ActivitiesPanelProps) {
  const [activeTab, setActiveTab] = useState<SubTab>("all");
  const [loggedActivities, setLoggedActivities] = useState<LeadActivityRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState<ActivityType>("call");
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyContext, setReplyContext] = useState<{ thread: EmailThread; lastMessage: Email } | null>(null);

  const isEducation = industryId === "education_consultancy";

  // Connected inboxes for EmailThreadCard (needed to identify own emails for participant display)
  const { inboxes: ownConnectedInboxes } = useConnectedInboxes();

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

  const handleReply = (thread: EmailThread, lastMessage: Email) => {
    setReplyContext({ thread, lastMessage });
    setComposeOpen(true);
  };

  const handleSent = (
    result: { thread_id: string; email_id: string },
    optimisticEmail: Email,
  ) => {
    if (replyContext) {
      // Reply: find existing thread and append the new message in-place
      setThreads((prev) =>
        prev.map((t) =>
          t.id === replyContext.thread.id
            ? {
                ...t,
                emails: [...t.emails, optimisticEmail],
                message_count: t.message_count + 1,
                last_message_at: optimisticEmail.sent_at ?? t.last_message_at,
              }
            : t,
        ),
      );
    } else {
      // Fresh compose: prepend a new thread
      const now = new Date().toISOString();
      const matchingInbox = ownConnectedInboxes.find((i) => i.email === optimisticEmail.from_email);
      const newThread: EmailThread = {
        id: result.thread_id,
        connected_email_account_id: matchingInbox?.id ?? "",
        gmail_thread_id: "",
        lead_id: leadId,
        contact_id: null,
        subject: optimisticEmail.subject,
        last_message_at: optimisticEmail.sent_at ?? now,
        message_count: 1,
        emails: [optimisticEmail],
        created_at: now,
        updated_at: now,
      };
      setThreads((prev) => [newThread, ...prev]);
    }
    setReplyContext(null);
  };

  const handleComposeClose = (open: boolean) => {
    setComposeOpen(open);
    if (!open) setReplyContext(null);
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

  const loggedEmailActivities = useMemo(
    () => loggedActivities.filter((a) => a.activity_type === "email"),
    [loggedActivities],
  );

  const unreadEmailCount = useMemo(
    () =>
      threads.reduce(
        (n, t) => n + t.emails.filter((e) => e.direction === "inbound" && !e.read_at).length,
        0
      ),
    [threads]
  );

  const handleThreadRead = (threadId: string) => {
    const now = new Date().toISOString();
    setThreads((prev) =>
      prev.map((t) =>
        t.id === threadId
          ? { ...t, emails: t.emails.map((e) => (e.direction === "inbound" ? { ...e, read_at: e.read_at ?? now } : e)) }
          : t
      )
    );
  };

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
            {isEducation && (
              <Button size="sm" onClick={() => { setReplyContext(null); setComposeOpen(true); }}>
                Compose Email
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => handleLogActivity("email")}>
              Log past email
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
        return isEducation
          ? "Compose an email to this lead, or log a past email to track your communication history."
          : "Log emails to keep track of your communication with this lead.";
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

  const isEmailsTabLoading = activeTab === "emails" && (isLoading || (isEducation && threadsLoading));
  const hasEmailContent = threads.length > 0 || loggedEmailActivities.length > 0;

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="border-b">
        <div className="flex gap-1 -mb-px overflow-x-auto">
          {SUB_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                activeTab === tab.id
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
              {tab.id === "emails" && unreadEmailCount > 0 && (
                <Badge variant="destructive" className="h-4 min-w-4 px-1 text-[10px] leading-none">
                  {unreadEmailCount > 9 ? "9+" : unreadEmailCount}
                </Badge>
              )}
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

      {/* Notes tab */}
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

      {/* Tasks tab */}
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

      {/* Emails sub-tab — threads (top) + logged emails (below, "Past activity") */}
      {activeTab === "emails" && (
        <>
          {isEmailsTabLoading ? (
            <Card className="shadow-none rounded-lg py-0">
              <CardContent className="p-8 text-center">
                <p className="text-muted-foreground">Loading emails...</p>
              </CardContent>
            </Card>
          ) : !hasEmailContent ? (
            <Card className="shadow-none rounded-lg py-0">
              <CardContent className="p-8 text-center">
                <Mail className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-muted-foreground">{getEmptyMessage()}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {/* Thread cards */}
              {threads.length > 0 && (
                <div className="space-y-2">
                  {threads.map((thread) => (
                    <EmailThreadCard
                      key={thread.id}
                      thread={thread}
                      currentUserId={currentUserId}
                      teamMemberEmails={teamMemberEmails}
                      ownConnectedInboxes={ownConnectedInboxes}
                      onReply={handleReply}
                      onThreadRead={handleThreadRead}
                    />
                  ))}
                </div>
              )}

              {/* Logged emails — "Past activity" subheader */}
              {loggedEmailActivities.length > 0 && (
                <div className="mt-2">
                  <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                    Past activity
                  </h3>
                  <div className="space-y-2">
                    {loggedEmailActivities.map((activity) => (
                      <div key={`logged-${activity.id}`} className="relative">
                        <div className="absolute top-3 right-10 z-10">
                          <Badge variant="secondary" className="text-xs">📝 Logged</Badge>
                        </div>
                        <ActivityCard
                          activity={activity}
                          onDelete={handleDeleteActivity}
                          canDelete={isAdmin || activity.user_id === currentUserId}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Activity list (all, calls, meetings) */}
      {(activeTab === "all" || activeTab === "calls" || activeTab === "meetings") && (
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

          {/* System activities on "all" tab */}
          {activeTab === "all" && systemActivities.length > 0 && (
            <div className="mt-6 pt-4 border-t">
              <h3 className="text-sm font-medium text-muted-foreground mb-3">System Activity</h3>
              <div className="space-y-2">
                {(() => {
                  const submissions = systemActivities.filter((a) => a.action === "lead.submission");
                  const others = systemActivities.filter((a) => a.action !== "lead.submission").slice(0, 10);
                  return [...submissions, ...others]
                    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                    .map((activity) => (
                      <SystemActivityItem
                        key={activity.id}
                        activity={activity}
                        teamMemberEmails={teamMemberEmails}
                        leadId={leadId}
                      />
                    ));
                })()}
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

      {/* Compose Email Dialog — education_consultancy only */}
      {isEducation && (
        <ComposeEmailDialog
          open={composeOpen}
          onOpenChange={handleComposeClose}
          defaultTo={leadEmail ?? ""}
          leadId={leadId}
          leadFirstName={leadFirstName}
          leadLastName={leadLastName}
          currentUserId={currentUserId}
          replyContext={replyContext ?? undefined}
          onSent={handleSent}
        />
      )}
    </div>
  );
}

// System activity item — collapsible for lead.submission entries, plain for all others
function SystemActivityItem({
  activity,
  teamMemberEmails,
  leadId,
}: {
  activity: LeadActivity;
  teamMemberEmails: Record<string, string>;
  leadId: string;
}) {
  const activityDate = new Date(activity.created_at);
  const isCurrentYear = activityDate.getFullYear() === new Date().getFullYear();
  const time = activityDate.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(isCurrentYear ? {} : { year: "numeric" }),
  });
  const userEmail = activity.user_id ? teamMemberEmails[activity.user_id] : null;
  const description = getSystemActivityDescription(activity, teamMemberEmails);
  const isSubmission = activity.action === "lead.submission";

  // Collapsible state for submission entries
  const [open, setOpen] = useState(false);
  const [submissionData, setSubmissionData] = useState<LeadSubmission | null>(null);
  const [submissionLoading, setSubmissionLoading] = useState(false);

  async function loadSubmission() {
    const submissionId = activity.changes?.submission_id?.new as string | null | undefined;
    if (!submissionId || submissionData || submissionLoading) return;
    setSubmissionLoading(true);
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/submissions/${submissionId}`);
      if (res.ok) {
        const json = await res.json();
        setSubmissionData(json.data as LeadSubmission);
      }
    } catch {
      // non-fatal — collapse stays empty
    } finally {
      setSubmissionLoading(false);
    }
  }

  const dotColor = isSubmission ? "bg-emerald-400" : "bg-gray-300";

  if (isSubmission) {
    return (
      <Collapsible
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (o) loadSubmission();
        }}
      >
        <div className="flex items-center gap-2 text-sm py-1">
          <div className={`h-2 w-2 rounded-full shrink-0 ${dotColor}`} />
          <CollapsibleTrigger className="flex items-center gap-1 text-foreground hover:underline underline-offset-2 cursor-pointer">
            <span>{description}</span>
            <ChevronDown
              className={`h-3 w-3 text-muted-foreground transition-transform duration-150 ${open ? "rotate-180" : ""}`}
            />
          </CollapsibleTrigger>
          <span className="text-muted-foreground shrink-0">· {time}</span>
          {userEmail && (
            <span className="text-muted-foreground truncate">· {userEmail}</span>
          )}
        </div>
        <CollapsibleContent className="pl-4 pt-1 pb-2">
          {submissionLoading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : submissionData ? (
            <SubmissionDetail submission={submissionData} />
          ) : (
            <p className="text-xs text-muted-foreground">No submission data available.</p>
          )}
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm py-1">
      <div className={`h-2 w-2 rounded-full ${dotColor}`} />
      <span className="text-foreground">{description}</span>
      <span className="text-muted-foreground">· {time}</span>
      {userEmail && <span className="text-muted-foreground">· {userEmail}</span>}
    </div>
  );
}

function SubmissionDetail({ submission }: { submission: LeadSubmission }) {
  const customFields = submission.custom_fields as Record<string, unknown>;
  const fileUrls = submission.file_urls as Record<string, unknown>;
  const hasCustomFields = Object.keys(customFields).length > 0;
  const hasFiles = Object.keys(fileUrls).length > 0;

  const SOURCE_LABELS: Record<string, string> = {
    public_form: "Public form",
    public_api: "Public API",
    integration: "Integration",
    manual: "Manual",
  };
  const sourceLabel = SOURCE_LABELS[submission.created_via];

  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center gap-2">
        {sourceLabel && (
          <Badge variant="secondary" className="text-xs">
            {sourceLabel}
          </Badge>
        )}
        {submission.matched_existing && (
          <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
            Repeat
          </Badge>
        )}
      </div>

      {hasCustomFields && (
        <div className="space-y-1 mt-1">
          {Object.entries(customFields).map(([key, val]) => (
            <div key={key} className="flex gap-2 text-muted-foreground">
              <span className="capitalize shrink-0">
                {key.replace(/_/g, " ")}:
              </span>
              <span className="text-foreground truncate">
                {Array.isArray(val) ? val.join(", ") : String(val ?? "—")}
              </span>
            </div>
          ))}
        </div>
      )}

      {hasFiles && (
        <div className="space-y-1 mt-1">
          <span className="text-muted-foreground">Files:</span>
          {Object.keys(fileUrls).map((key) => (
            <div key={key} className="flex items-center gap-1 text-foreground">
              <FileText className="h-3 w-3 shrink-0" />
              <span className="truncate">{key}</span>
            </div>
          ))}
        </div>
      )}

      {!hasCustomFields && !hasFiles && (
        <p className="text-muted-foreground">No field data recorded.</p>
      )}
    </div>
  );
}

function getSystemActivityDescription(
  activity: LeadActivity,
  teamMemberEmails: Record<string, string>
): string {
  const changes = activity.changes || {};

  // Submission (dedup-aware)
  if (activity.action === "lead.submission") {
    const isFirst = changes.is_first?.new === true;
    const formName = changes.form_name?.new as string | null;
    return isFirst
      ? `Lead created${formName ? ` · Filled ${formName}` : ""}`
      : `Filled ${formName || "form"}`;
  }

  if (activity.action === "lead.merged") {
    return "Duplicate record merged";
  }

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

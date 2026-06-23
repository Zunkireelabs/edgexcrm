"use client";

import { useState, useEffect, useMemo, useCallback, useRef, useImperativeHandle, forwardRef } from "react";
import dynamic from "next/dynamic";
import {
  Phone, Mail, Calendar, Clock, FileText, CheckSquare, ChevronDown,
  ArrowRight, Archive, CheckCircle2, Pencil, Users, UserMinus, UserPlus,
  GitMerge, Check,
  type LucideIcon,
} from "lucide-react";
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
import { NotesTab, type NotesTabRef } from "../notes-tab";
import { type EmailThread, type Email } from "@/industries/_shared/features/email/hooks/use-email-threads";
import { useConnectedInboxes } from "@/industries/_shared/features/email/hooks/use-connected-inboxes";

// Lazy-load compose dialog so TipTap only loads when the modal is opened
const ComposeEmailDialog = dynamic(
  () =>
    import(
      "@/industries/_shared/features/email/components/compose-email-dialog"
    ).then((m) => m.ComposeEmailDialog),
  { ssr: false },
);

// Lazy-load thread card
const EmailThreadCard = dynamic(
  () =>
    import(
      "@/industries/_shared/features/email/components/email-thread-card"
    ).then((m) => m.EmailThreadCard),
  { ssr: false },
);

type SubTab = "all" | "notes" | "emails" | "calls" | "tasks" | "meetings";

interface ActivitiesPanelProps {
  leadId: string;
  notes: LeadNote[];
  systemActivities: LeadActivity[];
  teamMemberEmails: Record<string, string>;
  teamMemberNames: Record<string, string>;
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

export interface ActivitiesPanelRef {
  /** Switch to the Notes sub-tab; pass true to also focus the composer. */
  openNotes: (focus?: boolean) => void;
}

export const ActivitiesPanel = forwardRef<ActivitiesPanelRef, ActivitiesPanelProps>(
  function ActivitiesPanel({
  leadId,
  notes,
  systemActivities,
  teamMemberEmails,
  teamMemberNames,
  isAdmin,
  onNotesChange,
  currentUserId,
  industryId,
  leadEmail,
  leadFirstName,
  leadLastName,
  threads,
  setThreads,
  threadsLoading,
}: ActivitiesPanelProps, ref) {
  const [activeTab, setActiveTab] = useState<SubTab>("all");
  const notesTabRef = useRef<NotesTabRef>(null);

  useImperativeHandle(ref, () => ({
    openNotes: (focus = false) => {
      setActiveTab("notes");
      if (focus) {
        setTimeout(() => notesTabRef.current?.focusComposer(), 50);
      }
    },
  }));
  const [loggedActivities, setLoggedActivities] = useState<LeadActivityRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState<ActivityType>("call");
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyContext, setReplyContext] = useState<{ thread: EmailThread; lastMessage: Email } | null>(null);

  const hasEmail = industryId === "education_consultancy" || industryId === "travel_agency";

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
            {hasEmail && (
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
        return hasEmail
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

  const isEmailsTabLoading = activeTab === "emails" && (isLoading || (hasEmail && threadsLoading));
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
              {tab.id === "notes" && notes.length > 0 && (
                <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[10px] leading-none">
                  {notes.length}
                </Badge>
              )}
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

      {/* Notes tab — full composer + cards (real names, relative time) */}
      {activeTab === "notes" && (
        <NotesTab
          ref={notesTabRef}
          leadId={leadId}
          notes={notes}
          onNotesChange={onNotesChange}
          teamMemberNames={teamMemberNames}
          teamMemberEmails={teamMemberEmails}
          currentUserId={currentUserId}
        />
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
              <h3 className="text-sm font-medium text-muted-foreground mb-4">System Activity</h3>
              {(() => {
                const submissions = systemActivities.filter((a) => a.action === "lead.submission");
                const others = systemActivities.filter((a) => a.action !== "lead.submission").slice(0, 10);
                const sorted = [...submissions, ...others].sort(
                  (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                );
                const groups = groupByDay(sorted);
                return groups.map((group, gi) => (
                  <div key={group.dayKey}>
                    <p className={`text-xs font-medium text-muted-foreground mb-2${gi > 0 ? " mt-4" : ""}`}>
                      {group.label}
                    </p>
                    {group.items.map((activity, idx) => (
                      <SystemActivityItem
                        key={activity.id}
                        activity={activity}
                        teamMemberEmails={teamMemberEmails}
                        teamMemberNames={teamMemberNames}
                        currentUserId={currentUserId}
                        leadId={leadId}
                        isLast={idx === group.items.length - 1}
                      />
                    ))}
                  </div>
                ));
              })()}
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

      {/* Compose Email Dialog — tenants with the email feature (education + travel) */}
      {hasEmail && (
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
});

// System activity item — monochrome timeline node
function SystemActivityItem({
  activity,
  teamMemberEmails,
  teamMemberNames,
  currentUserId,
  leadId,
  isLast,
}: {
  activity: LeadActivity;
  teamMemberEmails: Record<string, string>;
  teamMemberNames: Record<string, string>;
  currentUserId: string;
  leadId: string;
  isLast: boolean;
}) {
  const time = formatTimeOnly(activity.created_at);
  const actor = resolveActorLabel(activity.user_id, currentUserId, teamMemberNames, teamMemberEmails);
  const description = getSystemActivityDescription(activity, teamMemberEmails);
  const isSubmission = activity.action === "lead.submission";
  const Icon = getSystemActivityIcon(activity);
  const subline = [time, actor].filter(Boolean).join(" · ");

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

  const nodeCircle = (
    <div className="h-6 w-6 rounded-full border border-border bg-background flex items-center justify-center shrink-0">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
    </div>
  );

  if (isSubmission) {
    return (
      <Collapsible
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (o) loadSubmission();
        }}
      >
        <div className="flex gap-3">
          <div className="flex flex-col items-center">
            {nodeCircle}
            {!isLast && <div className="w-px bg-border flex-1 mt-1" />}
          </div>
          <div className="min-w-0 pb-3 flex-1">
            <CollapsibleTrigger className="flex items-center gap-1 text-sm text-foreground hover:underline underline-offset-2 cursor-pointer text-left">
              <span className="min-w-0">{description}</span>
              <ChevronDown
                className={`h-3 w-3 text-muted-foreground transition-transform duration-150 shrink-0 ${open ? "rotate-180" : ""}`}
              />
            </CollapsibleTrigger>
            {subline && <p className="text-xs text-muted-foreground mt-0.5">{subline}</p>}
            <CollapsibleContent className="pt-2">
              {submissionLoading ? (
                <p className="text-xs text-muted-foreground">Loading…</p>
              ) : submissionData ? (
                <SubmissionDetail submission={submissionData} />
              ) : (
                <p className="text-xs text-muted-foreground">No submission data available.</p>
              )}
            </CollapsibleContent>
          </div>
        </div>
      </Collapsible>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        {nodeCircle}
        {!isLast && <div className="w-px bg-border flex-1 mt-1" />}
      </div>
      <div className="min-w-0 pb-3 flex-1">
        <p className="text-sm text-foreground">{description}</p>
        {subline && <p className="text-xs text-muted-foreground mt-0.5">{subline}</p>}
      </div>
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

function getSystemActivityIcon(activity: LeadActivity): LucideIcon {
  const changes = activity.changes || {};

  if (activity.action === "lead.submission") {
    const isFirst = (changes as Record<string, { new?: unknown }>).is_first?.new === true;
    return isFirst ? UserPlus : FileText;
  }
  if (activity.action === "lead.merged") return GitMerge;
  if (activity.action === "lead.note_added") return FileText;
  if (activity.action === "lead.branch_revoked") return UserMinus;
  if (activity.action === "lead.branch_shared" || activity.action === "lead.branch_assigned") return Users;

  const ch = changes as Record<string, { old?: unknown; new?: unknown }>;
  if (ch.list) {
    const reason = ch.archive_reason?.new as string | null;
    if (reason) return Archive;
    const to = ch.list.new as string | null;
    if (to?.toLowerCase() === "qualified") return CheckCircle2;
    return ArrowRight;
  }
  if (ch.assigned_to) return Users;
  if (activity.action === "lead.updated") return Pencil;
  return Check;
}

function resolveActorLabel(
  userId: string | null | undefined,
  currentUserId: string,
  teamMemberNames: Record<string, string>,
  teamMemberEmails: Record<string, string>
): string | null {
  if (!userId) return null;
  if (userId === currentUserId) return "you";
  return teamMemberNames[userId] || teamMemberEmails[userId] || null;
}

function formatTimeOnly(dateString: string): string {
  return new Date(dateString).toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDayLabel(date: Date): string {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (dateStart.getTime() === todayStart.getTime()) return "Today";
  if (dateStart.getTime() === yesterdayStart.getTime()) return "Yesterday";

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

function groupByDay(
  activities: LeadActivity[]
): { dayKey: string; label: string; items: LeadActivity[] }[] {
  const groups: { dayKey: string; label: string; items: LeadActivity[] }[] = [];
  const seen = new Map<string, number>();

  for (const activity of activities) {
    const date = new Date(activity.created_at);
    const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const existing = seen.get(dayKey);
    if (existing !== undefined) {
      groups[existing].items.push(activity);
    } else {
      seen.set(dayKey, groups.length);
      groups.push({ dayKey, label: formatDayLabel(date), items: [activity] });
    }
  }

  return groups;
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

  if (activity.action === "lead.note_added") {
    return "Added a note";
  }

  if (activity.action === "lead.branch_shared") {
    const branch = changes.branch?.new as string | null;
    const a = changes.assigned_to?.new;
    const email = a ? teamMemberEmails[String(a)] : null;
    return `Shared to ${branch || "a branch"}${email ? ` · assigned to ${email}` : ""}`;
  }

  if (activity.action === "lead.branch_revoked") {
    const branch = changes.branch?.old as string | null;
    return `Removed from ${branch || "a branch"}`;
  }

  if (activity.action === "lead.branch_assigned") {
    const branch = changes.branch?.new as string | null;
    const a = changes.assigned_to?.new;
    const email = a ? teamMemberEmails[String(a)] : null;
    return email
      ? `Assigned ${email} in ${branch || "a branch"}`
      : `Unassigned in ${branch || "a branch"}`;
  }

  if (changes.list) {
    const from = changes.list.old as string | null;
    const to = changes.list.new as string | null;
    const reason = changes.archive_reason?.new as string | null;
    if (reason) return `Archived · ${reason}`;
    return from ? `Moved from "${from}" to "${to}"` : `Added to "${to}"`;
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

  // Generic lead.updated: build "Updated name, destinations, …" from the changed fields
  if (activity.action === "lead.updated" && Object.keys(changes).length > 0) {
    const FIELD_LABELS: Record<string, string> = {
      first_name: "name",
      last_name: "name",
      phone: "phone",
      email: "email",
      destinations: "destinations",
      field_of_study: "field of study",
      degree_level: "degree level",
      tags: "tags",
      intake_source: "source",
      source: "source",
      custom_fields: "details",
      notes: "notes",
      status: "stage",
      stage_id: "stage",
      city: "city",
      country: "country",
      company_name: "company",
      designation: "designation",
      salutation: "salutation",
      preferred_contact_method: "contact method",
    };
    const seen = new Set<string>();
    const labels: string[] = [];
    for (const key of Object.keys(changes)) {
      const label = FIELD_LABELS[key] ?? key.replace(/_/g, " ");
      if (!seen.has(label)) {
        seen.add(label);
        labels.push(label);
      }
    }
    if (labels.length > 0) return `Updated ${labels.join(", ")}`;
  }

  // Humanized fallback — never render a raw dotted action string
  const actionParts = activity.action.split(".");
  const readable = (actionParts.length > 1 ? actionParts.slice(1).join(" ") : actionParts[0]).replace(/_/g, " ");
  return readable.charAt(0).toUpperCase() + readable.slice(1);
}

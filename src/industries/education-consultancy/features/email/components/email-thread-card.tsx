"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Reply } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { EmailThread, Email } from "../hooks/use-email-threads";

interface EmailThreadCardProps {
  thread: EmailThread;
  currentUserId: string;
  teamMemberEmails: Record<string, string>;
  ownConnectedInboxes: Array<{ id: string; email: string }>;
  onReply: (thread: EmailThread, lastMessage: Email) => void;
  onThreadRead?: (threadId: string) => void;
}

function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return "";
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTimestamp(dateString: string | null): string {
  if (!dateString) return "";
  return new Date(dateString).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getInitial(name: string | null, email: string): string {
  if (name) return name[0].toUpperCase();
  return email[0].toUpperCase();
}

function getParticipants(thread: EmailThread, ownEmails: Set<string>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const email of thread.emails) {
    if (!ownEmails.has(email.from_email) && !seen.has(email.from_email)) {
      seen.add(email.from_email);
      result.push(email.from_name ? `${email.from_name}` : email.from_email);
    }
  }
  return result;
}

function MessageRow({
  email,
  teamMemberEmails,
}: {
  email: Email;
  teamMemberEmails: Record<string, string>;
}) {
  const isInbound = email.direction === "inbound";
  const timestamp = formatTimestamp(email.sent_at ?? email.received_at);

  const senderLabel = isInbound
    ? (email.from_name ?? email.from_email)
    : (email.sender_user_id ? (teamMemberEmails[email.sender_user_id] ?? email.from_email) : email.from_email);

  return (
    <div className={`flex gap-3 ${isInbound ? "" : "flex-row-reverse"}`}>
      {/* Avatar */}
      <div
        className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 text-sm font-medium ${
          isInbound ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-700"
        }`}
      >
        {getInitial(isInbound ? email.from_name : null, email.from_email)}
      </div>

      {/* Bubble */}
      <div
        className={`flex-1 min-w-0 rounded-lg p-3 text-sm ${
          isInbound ? "bg-blue-50 border border-blue-100" : "bg-gray-50 border border-gray-100"
        }`}
      >
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="font-medium text-foreground truncate">{senderLabel}</span>
          <span className="text-xs text-muted-foreground shrink-0">{timestamp}</span>
        </div>
        {email.to_emails.length > 0 && (
          <p className="text-xs text-muted-foreground mb-2">
            to {email.to_emails.join(", ")}
            {email.cc_emails.length > 0 && `, cc ${email.cc_emails.join(", ")}`}
          </p>
        )}
        <div
          className="prose prose-sm max-w-none text-foreground"
          dangerouslySetInnerHTML={{ __html: email.body_html }}
        />
      </div>
    </div>
  );
}

export function EmailThreadCard({
  thread,
  teamMemberEmails,
  ownConnectedInboxes,
  onReply,
  onThreadRead,
}: EmailThreadCardProps) {
  const [expanded, setExpanded] = useState(false);

  const hasInbound = thread.emails.some((e) => e.direction === "inbound");
  const hasUnreadInbound = thread.emails.some((e) => e.direction === "inbound" && !e.read_at);
  const lastMessage = thread.emails[thread.emails.length - 1] ?? null;
  const ownEmailSet = new Set(ownConnectedInboxes.map((i) => i.email));
  const participants = getParticipants(thread, ownEmailSet);
  const relativeTime = formatRelativeTime(thread.last_message_at);

  // "Reply" uses the last message in the thread
  const handleReply = () => {
    if (lastMessage) onReply(thread, lastMessage);
  };

  const handleToggleExpand = () => {
    const willExpand = !expanded;
    setExpanded(willExpand);
    if (willExpand && hasUnreadInbound && onThreadRead) {
      fetch(`/api/v1/email/threads/${thread.id}/read`, { method: "PATCH" }).catch(() => {});
      onThreadRead(thread.id);
    }
  };

  return (
    <Card className="shadow-none rounded-lg py-0">
      <CardContent className="p-3">
        {/* Collapsed header */}
        <div
          className="flex items-start gap-2 cursor-pointer"
          onClick={handleToggleExpand}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && handleToggleExpand()}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-medium text-foreground truncate">{thread.subject}</p>
              <Badge variant="secondary" className="text-xs shrink-0">
                {hasInbound ? "⬅ Reply" : "✉ Sent"}
              </Badge>
              {thread.message_count > 1 && (
                <Badge variant="outline" className="text-xs shrink-0">
                  {thread.message_count} messages
                </Badge>
              )}
            </div>
            {participants.length > 0 && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                {participants.join(", ")}
              </p>
            )}
            <p className="text-xs text-muted-foreground">{relativeTime}</p>
          </div>
          <button
            className="text-muted-foreground hover:text-foreground shrink-0 mt-0.5"
            aria-label={expanded ? "Collapse thread" : "Expand thread"}
            tabIndex={-1}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>

        {/* Expanded: messages + reply button */}
        {expanded && (
          <div className="mt-3 border-t pt-3 space-y-3">
            {thread.emails.map((email) => (
              <MessageRow
                key={email.id}
                email={email}
                teamMemberEmails={teamMemberEmails}
              />
            ))}
            <div className="flex justify-end pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  handleReply();
                }}
              >
                <Reply className="h-3.5 w-3.5 mr-1.5" />
                Reply
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export type { EmailThread, Email };

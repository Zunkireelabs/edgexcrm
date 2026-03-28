"use client";

import { Phone, Mail, Calendar, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { LeadActivityRecord, ActivityType } from "@/types/database";

interface ActivityCardProps {
  activity: LeadActivityRecord;
  onDelete?: (id: string) => void;
  canDelete?: boolean;
}

const ACTIVITY_ICONS: Record<ActivityType, React.ReactNode> = {
  call: <Phone className="h-4 w-4" />,
  email: <Mail className="h-4 w-4" />,
  meeting: <Calendar className="h-4 w-4" />,
};

const ACTIVITY_COLORS: Record<ActivityType, string> = {
  call: "bg-green-100 text-green-600",
  email: "bg-blue-100 text-blue-600",
  meeting: "bg-purple-100 text-purple-600",
};

const CALL_OUTCOME_LABELS: Record<string, string> = {
  connected: "Connected",
  left_voicemail: "Left Voicemail",
  no_answer: "No Answer",
  busy: "Busy",
  wrong_number: "Wrong Number",
};

export function ActivityCard({ activity, onDelete, canDelete }: ActivityCardProps) {
  const icon = ACTIVITY_ICONS[activity.activity_type];
  const color = ACTIVITY_COLORS[activity.activity_type];

  const time = new Date(activity.created_at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const getTitle = () => {
    switch (activity.activity_type) {
      case "call":
        return `Call${activity.call_outcome ? ` · ${CALL_OUTCOME_LABELS[activity.call_outcome]}` : ""}`;
      case "email":
        return activity.email_subject || activity.subject || "Email";
      case "meeting":
        return activity.subject || "Meeting";
    }
  };

  const getSubtitle = () => {
    const parts: string[] = [];

    if (activity.activity_type === "call" && activity.duration_minutes) {
      parts.push(`Duration: ${activity.duration_minutes} min`);
    }

    if (activity.activity_type === "meeting") {
      if (activity.location) parts.push(`Location: ${activity.location}`);
      if (activity.scheduled_at) {
        const date = new Date(activity.scheduled_at).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
        parts.push(`Scheduled: ${date}`);
      }
    }

    return parts.join(" · ");
  };

  return (
    <Card className="shadow-none rounded-lg py-0 group">
      <CardContent className="p-3">
        <div className="flex gap-3">
          <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${color}`}>
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-foreground">{getTitle()}</p>
                <p className="text-xs text-muted-foreground">
                  {activity.user_email ? `by ${activity.user_email}` : ""} · {time}
                </p>
              </div>
              {canDelete && onDelete && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => onDelete(activity.id)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                </Button>
              )}
            </div>
            {getSubtitle() && (
              <p className="text-xs text-muted-foreground mt-1">{getSubtitle()}</p>
            )}
            {activity.description && (
              <p className="text-sm text-foreground mt-2">{activity.description}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

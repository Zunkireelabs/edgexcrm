"use client";

import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Calendar, Clock, MapPin, User } from "lucide-react";
import type { Application } from "@/types/database";
import { normalizeDestinations } from "@/lib/leads/destination-normalize";

interface ApplicationCardProps {
  application: Application;
  disabled: boolean;
  onOpenDetail?: (app: Application) => void;
  /** Resolved display name for application.assigned_to, matching the leads-Kanban avatar row. */
  assigneeName?: string;
}

const AVATAR_COLORS = [
  { bg: "bg-blue-100 dark:bg-blue-900/40", text: "text-blue-700 dark:text-blue-300" },
  { bg: "bg-emerald-100 dark:bg-emerald-900/40", text: "text-emerald-700 dark:text-emerald-300" },
  { bg: "bg-violet-100 dark:bg-violet-900/40", text: "text-violet-700 dark:text-violet-300" },
  { bg: "bg-amber-100 dark:bg-amber-900/40", text: "text-amber-700 dark:text-amber-300" },
  { bg: "bg-pink-100 dark:bg-pink-900/40", text: "text-pink-700 dark:text-pink-300" },
  { bg: "bg-cyan-100 dark:bg-cyan-900/40", text: "text-cyan-700 dark:text-cyan-300" },
];

function colorFor(name: string): { bg: string; text: string } {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// Applications don't have their own stage_changed_at column (unlike leads) — age is
// measured off updated_at, same as the leads card did before LEADS-KANBAN-REDESIGN.
function getDaysInStage(dateString: string): number {
  const diff = Date.now() - new Date(dateString).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function getUrgencyStyles(days: number): { bg: string; text: string } {
  if (days >= 7) return { bg: "bg-red-100 dark:bg-red-900/30", text: "text-red-700 dark:text-red-400" };
  if (days >= 3) return { bg: "bg-amber-100 dark:bg-amber-900/30", text: "text-amber-700 dark:text-amber-400" };
  return { bg: "bg-muted", text: "text-muted-foreground" };
}

function getInitials(firstName: string | null, lastName: string | null): string {
  const first = firstName?.[0]?.toUpperCase() || "";
  const last = lastName?.[0]?.toUpperCase() || "";
  return first + last || "?";
}

/** Relative "1m / 30m / 2h / 5d" — last-changed (any field), distinct from the stage-age badge. */
function formatRelativeTime(dateString: string): string {
  const diffMs = Date.now() - new Date(dateString).getTime();
  const minutes = Math.floor(diffMs / (1000 * 60));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function formatDate(dateString: string | null): string {
  if (!dateString) return "";
  return new Date(dateString).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getStudentName(app: Application): { first: string | null; last: string | null; full: string } {
  const lead = app.leads as { first_name: string | null; last_name: string | null } | null;
  if (!lead) return { first: null, last: null, full: "Unknown Student" };
  const full = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Unknown Student";
  return { first: lead.first_name, last: lead.last_name, full };
}

export function ApplicationCard({ application, disabled, onOpenDetail, assigneeName }: ApplicationCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: application.id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const leadId = (application.leads as { id?: string } | null)?.id ?? application.lead_id;
  const student = getStudentName(application);
  const days = getDaysInStage(application.stage_changed_at);
  const urgencyStyles = getUrgencyStyles(days);
  const avatarColors = colorFor(student.full);

  function handleCardClick() {
    onOpenDetail?.(application);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpenDetail?.(application);
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      className={`group rounded-[12px] border bg-card p-4 transition-all ${
        isDragging
          ? "opacity-50 ring-2 ring-primary/20 scale-[1.02]"
          : "hover:border-muted-foreground/30"
      } ${disabled ? "cursor-default" : "cursor-grab active:cursor-grabbing"}`}
    >
      {/* Header: Application title = university, subtitle = program */}
      <div className="mb-3">
        <p className="text-sm font-semibold line-clamp-1">{application.university_name}</p>
        <p className="text-xs text-muted-foreground truncate mt-0.5">{application.program_name}</p>
      </div>

      {/* Application details */}
      <div className="space-y-1 mb-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <User className="h-3 w-3 shrink-0" />
          <Link
            href={`/leads/${leadId}`}
            prefetch={false}
            onClick={(e) => e.stopPropagation()}
            className="truncate hover:text-primary hover:underline"
          >
            {student.full}
          </Link>
        </div>
        {application.intake_term && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Calendar className="h-3 w-3 shrink-0" />
            <span className="truncate">{application.intake_term}</span>
          </div>
        )}
        {application.countries && application.countries.length > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{normalizeDestinations(application.countries).join(", ")}</span>
          </div>
        )}
        {application.application_deadline && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Calendar className="h-3 w-3 shrink-0" />
            <span>{formatDate(application.application_deadline)}</span>
          </div>
        )}
      </div>

      {application.offer_type && (
        <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full mb-3 ${
          application.offer_type === "unconditional"
            ? "bg-teal-100 text-teal-700"
            : "bg-yellow-100 text-yellow-700"
        }`}>
          {application.offer_type === "unconditional" ? "Unconditional Offer" : "Conditional Offer"}
        </span>
      )}

      {/* Divider */}
      <div className="border-t border-border/50 my-3" />

      {/* Footer: stage-age badge (stage moves only) + last-activity time (any edit) + assignee avatar */}
      <div className="flex items-center justify-between text-[11px]">
        <div
          className={`flex items-center gap-1 px-2 py-1 rounded-full font-medium ${urgencyStyles.bg} ${urgencyStyles.text}`}
          title={`Stage changed ${new Date(application.stage_changed_at).toLocaleString()}`}
        >
          <Clock className="h-3 w-3" />
          <span>{days === 0 ? "Today" : `${days}d`}</span>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-muted-foreground" title={`Last changed ${new Date(application.updated_at).toLocaleString()}`}>
            {formatRelativeTime(application.updated_at)}
          </span>
          <span className="text-muted-foreground truncate max-w-20" title={assigneeName ?? (application.assigned_to ? "Assigned" : "Unassigned")}>
            {application.assigned_to ? assigneeName ?? "Assigned" : "Unassigned"}
          </span>
          <div
            className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
              application.assigned_to ? `${avatarColors.bg} ${avatarColors.text}` : "bg-muted border border-border"
            }`}
          >
            {application.assigned_to ? getInitials(student.first, student.last) : <User className="h-3 w-3 text-muted-foreground" />}
          </div>
        </div>
      </div>
    </div>
  );
}

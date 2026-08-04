"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import type { PipelineLead } from "@/types/database";
import {
  Clock,
  MoreHorizontal,
  Mail,
  Phone,
  ExternalLink,
  User,
  ArrowRightLeft,
  CheckSquare,
  ListTodo,
  Paperclip,
  Flame,
  Sun,
  Snowflake,
} from "lucide-react";
import { MoveToPipelineModal } from "./MoveToPipelineModal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface LeadCardProps {
  lead: PipelineLead;
  disabled: boolean;
  pipelineId?: string;
  onMovedToPipeline?: (leadId: string) => void;
  /** Resolved display name for lead.assigned_to (KanbanBoard/PipelineColumn build the
   * id->name map once from teamMembersData) — PIPELINE-CARD-REDESIGN. */
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

const PRIORITY_STYLES: Record<string, { label: string; icon: typeof Flame; bg: string; text: string }> = {
  hot: { label: "Hot", icon: Flame, bg: "bg-red-100 dark:bg-red-900/30", text: "text-red-700 dark:text-red-400" },
  warm: { label: "Warm", icon: Sun, bg: "bg-amber-100 dark:bg-amber-900/30", text: "text-amber-700 dark:text-amber-400" },
  cold: { label: "Cold", icon: Snowflake, bg: "bg-sky-100 dark:bg-sky-900/30", text: "text-sky-700 dark:text-sky-400" },
};

function getDaysInStage(updatedAt: string): number {
  const diff = Date.now() - new Date(updatedAt).getTime();
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

/** Relative "1m / 30m / 2h / 5d" — same grain as the reference design's activity chip. */
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

export function LeadCard({ lead, disabled, pipelineId, onMovedToPipeline, assigneeName }: LeadCardProps) {
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: lead.id,
    disabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const fullName = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Unknown";
  const subtitleParts = [lead.country, lead.phone].filter(Boolean);
  const days = getDaysInStage(lead.updated_at);
  const urgencyStyles = getUrgencyStyles(days);
  const avatarColors = colorFor(fullName);
  const priority = lead.ai_priority ? PRIORITY_STYLES[lead.ai_priority] : null;
  const attachmentCount = Object.keys(lead.file_urls || {}).length;
  const hasChecklist = (lead.checklist_total ?? 0) > 0;
  const hasTasks = (lead.task_total ?? 0) > 0;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  const handleEmailClick = () => {
    if (lead.email) window.location.href = `mailto:${lead.email}`;
  };

  const handlePhoneClick = () => {
    if (lead.phone) window.location.href = `tel:${lead.phone}`;
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`group rounded-[12px] border bg-card p-4 transition-all ${
        isDragging
          ? "opacity-50 ring-2 ring-primary/20 scale-[1.02]"
          : "hover:border-muted-foreground/30"
      } ${disabled ? "cursor-default" : "cursor-grab active:cursor-grabbing"}`}
    >
      {/* Header: Name + Actions */}
      <div className="flex items-start gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <Link
            href={`/leads/${lead.id}`}
            prefetch={false}
            className="text-sm font-semibold hover:text-primary transition-colors line-clamp-1 block"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {fullName}
          </Link>
          {subtitleParts.length > 0 && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {subtitleParts.join(" · ")}
            </p>
          )}
          {lead.email && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {lead.email}
            </p>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 -mr-1 -mt-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem asChild>
              <Link href={`/leads/${lead.id}`} prefetch={false}>
                <ExternalLink className="mr-2 h-3.5 w-3.5" />
                View Details
              </Link>
            </DropdownMenuItem>
            {pipelineId && onMovedToPipeline && (
              <DropdownMenuItem onClick={() => setMoveModalOpen(true)}>
                <ArrowRightLeft className="mr-2 h-3.5 w-3.5" />
                Move to Pipeline
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {lead.phone && (
              <DropdownMenuItem onClick={handlePhoneClick}>
                <Phone className="mr-2 h-3.5 w-3.5" />
                Call {lead.phone}
              </DropdownMenuItem>
            )}
            {lead.email && (
              <DropdownMenuItem onClick={handleEmailClick}>
                <Mail className="mr-2 h-3.5 w-3.5" />
                Email {lead.email}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {lead.email && (
              <DropdownMenuItem onClick={() => copyToClipboard(lead.email!, "Email")}>
                <Mail className="mr-2 h-3.5 w-3.5" />
                Copy Email
              </DropdownMenuItem>
            )}
            {lead.phone && (
              <DropdownMenuItem onClick={() => copyToClipboard(lead.phone!, "Phone")}>
                <Phone className="mr-2 h-3.5 w-3.5" />
                Copy Phone
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Assignee row */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
              lead.assigned_to ? `${avatarColors.bg} ${avatarColors.text}` : "bg-muted border border-border"
            }`}
            title={assigneeName ?? (lead.assigned_to ? "Assigned" : "Unassigned")}
          >
            {lead.assigned_to ? getInitials(lead.first_name, lead.last_name) : <User className="h-3 w-3 text-muted-foreground" />}
          </div>
          <span className="text-xs text-muted-foreground truncate">
            {lead.assigned_to ? assigneeName ?? "Assigned" : "Unassigned"}
          </span>
        </div>

        {priority && (
          <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold flex-shrink-0 ${priority.bg} ${priority.text}`}>
            <priority.icon className="h-3 w-3" />
            {priority.label}
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="border-t border-border/50 my-3" />

      {/* Footer: activity + checklist + attachments */}
      <div className="flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-2 text-muted-foreground">
          <div className={`flex items-center gap-1 px-2 py-1 rounded-full font-medium ${urgencyStyles.bg} ${urgencyStyles.text}`}>
            <Clock className="h-3 w-3" />
            <span>{days === 0 ? "Today" : `${days}d`}</span>
          </div>

          {hasChecklist && (
            <div className="flex items-center gap-1">
              <CheckSquare className="h-3 w-3" />
              <span>{lead.checklist_completed}/{lead.checklist_total}</span>
            </div>
          )}

          {hasTasks && (
            <div className="flex items-center gap-1">
              <ListTodo className="h-3 w-3" />
              <span>{lead.task_completed}/{lead.task_total}</span>
            </div>
          )}

          {attachmentCount > 0 && (
            <div className="flex items-center gap-1">
              <Paperclip className="h-3 w-3" />
              <span>{attachmentCount}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-muted-foreground" title={new Date(lead.last_activity_at).toLocaleString()}>
            {formatRelativeTime(lead.last_activity_at)}
          </span>
          <div
            className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
              lead.assigned_to ? `${avatarColors.bg} ${avatarColors.text}` : "bg-muted border border-border"
            }`}
          >
            {lead.assigned_to ? getInitials(lead.first_name, lead.last_name) : <User className="h-3 w-3 text-muted-foreground" />}
          </div>
        </div>
      </div>

      {/* Move to Pipeline Modal */}
      {pipelineId && onMovedToPipeline && (
        <MoveToPipelineModal
          open={moveModalOpen}
          onClose={() => setMoveModalOpen(false)}
          lead={lead}
          currentPipelineId={pipelineId}
          onMoved={onMovedToPipeline}
        />
      )}
    </div>
  );
}

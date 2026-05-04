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
  FileText,
  User,
  ArrowRightLeft,
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface LeadCardProps {
  lead: PipelineLead;
  disabled: boolean;
  pipelineId?: string;
  onMovedToPipeline?: (leadId: string) => void;
}

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

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

export function LeadCard({ lead, disabled, pipelineId, onMovedToPipeline }: LeadCardProps) {
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
  const subtitle = lead.country || (lead.custom_fields?.course_name as string) || null;
  const days = getDaysInStage(lead.updated_at);
  const urgencyStyles = getUrgencyStyles(days);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  const handleEmailClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (lead.email) {
      window.location.href = `mailto:${lead.email}`;
    }
  };

  const handlePhoneClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (lead.phone) {
      window.location.href = `tel:${lead.phone}`;
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`group rounded-xl border bg-card p-4 transition-all ${
        isDragging
          ? "opacity-50 ring-2 ring-primary/20 scale-[1.02]"
          : "hover:border-muted-foreground/30"
      } ${disabled ? "cursor-default" : "cursor-grab active:cursor-grabbing"}`}
    >
      {/* Header: Icon + Name + Actions */}
      <div className="flex items-start gap-3 mb-2">
        <div className="flex-shrink-0 h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <FileText className="h-4 w-4 text-primary" />
        </div>

        <div className="flex-1 min-w-0">
          <Link
            href={`/leads/${lead.id}`}
            className="text-sm font-semibold hover:text-primary transition-colors line-clamp-1 block"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {fullName}
          </Link>
          {subtitle && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {subtitle}
            </p>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 -mr-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem asChild>
              <Link href={`/leads/${lead.id}`}>
                <ExternalLink className="mr-2 h-3.5 w-3.5" />
                View Details
              </Link>
            </DropdownMenuItem>
            {pipelineId && onMovedToPipeline && (
              <DropdownMenuItem
                onClick={() => setMoveModalOpen(true)}
              >
                <ArrowRightLeft className="mr-2 h-3.5 w-3.5" />
                Move to Pipeline
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

      {/* Divider */}
      <div className="border-t border-border/50 my-3" />

      {/* Metadata Grid */}
      <div className="space-y-2 text-xs">
        {lead.phone && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-16 flex-shrink-0">Phone</span>
            <span className="text-foreground truncate">{truncateText(lead.phone, 18)}</span>
          </div>
        )}
        {lead.email && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-16 flex-shrink-0">Email</span>
            <span className="text-foreground truncate">{truncateText(lead.email, 20)}</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-16 flex-shrink-0">Created</span>
          <span className="text-foreground">{formatDate(lead.created_at)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-16 flex-shrink-0">Assigned</span>
          <span className="text-foreground">
            {lead.assigned_to ? "Assigned" : "Unassigned"}
          </span>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-border/50 my-3" />

      {/* Footer: Time badge + Action chips + Avatar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {/* Time Badge */}
          <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium ${urgencyStyles.bg} ${urgencyStyles.text}`}>
            <Clock className="h-3 w-3" />
            <span>{days === 0 ? "Today" : `${days}d`}</span>
          </div>

          {/* Action Chips */}
          <TooltipProvider delayDuration={300}>
            {lead.phone && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handlePhoneClick}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="h-6 w-6 rounded-full bg-muted hover:bg-muted/80 flex items-center justify-center transition-colors"
                  >
                    <Phone className="h-3 w-3 text-muted-foreground" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  Call {lead.phone}
                </TooltipContent>
              </Tooltip>
            )}
            {lead.email && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleEmailClick}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="h-6 w-6 rounded-full bg-muted hover:bg-muted/80 flex items-center justify-center transition-colors"
                  >
                    <Mail className="h-3 w-3 text-muted-foreground" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  Email {lead.email}
                </TooltipContent>
              </Tooltip>
            )}
          </TooltipProvider>
        </div>

        {/* Assignee Avatar */}
        {lead.assigned_to ? (
          <div
            className="h-6 w-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-[10px] font-bold text-primary"
            title={`Assigned`}
          >
            {getInitials(lead.first_name, lead.last_name)}
          </div>
        ) : (
          <div
            className="h-6 w-6 rounded-full bg-muted border border-border flex items-center justify-center"
            title="Unassigned"
          >
            <User className="h-3 w-3 text-muted-foreground" />
          </div>
        )}
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

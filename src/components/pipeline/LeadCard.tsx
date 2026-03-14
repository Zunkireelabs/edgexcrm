"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import type { PipelineLead } from "@/types/database";
import { CheckSquare, Clock, MoreHorizontal, Mail, Phone, ExternalLink } from "lucide-react";
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
}

function getDaysInStage(updatedAt: string): number {
  const diff = Date.now() - new Date(updatedAt).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function getUrgencyColor(days: number): string {
  if (days >= 7) return "text-red-600 font-semibold";
  if (days >= 3) return "text-amber-600 font-semibold";
  return "text-muted-foreground";
}

function getInitials(name: string | null): string {
  if (!name) return "?";
  const parts = name.split(" ").filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function LeadCard({ lead, disabled }: LeadCardProps) {
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
  const days = getDaysInStage(lead.updated_at);
  const urgencyClass = getUrgencyColor(days);
  
  const progress = lead.checklist_total > 0 
    ? Math.round((lead.checklist_completed / lead.checklist_total) * 100) 
    : 0;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`group rounded-lg border bg-card p-3 shadow-sm transition-all ${
        isDragging ? "opacity-50 shadow-lg ring-2 ring-primary/20" : "hover:shadow-md hover:border-muted-foreground/30"
      } ${disabled ? "cursor-default" : "cursor-grab active:cursor-grabbing"}`}
    >
      {/* Header with Name + Actions */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <Link
          href={`/leads/${lead.id}`}
          className="text-sm font-semibold hover:text-primary transition-colors line-clamp-1 flex-1"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {fullName}
        </Link>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-6 w-6 -mr-1 opacity-0 group-hover:opacity-100 transition-opacity"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem asChild>
              <Link href={`/leads/${lead.id}`}>
                <ExternalLink className="mr-2 h-3.5 w-3.5" />
                View Details
              </Link>
            </DropdownMenuItem>
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

      {/* Info fields */}
      <div className="space-y-0.5 text-[11px] text-muted-foreground mb-3">
        {lead.country && <p className="truncate">{lead.country}</p>}
        {lead.custom_fields?.course_name ? (
          <p className="truncate italic">
            {String(lead.custom_fields.course_name)}
          </p>
        ) : null}
      </div>

      {/* Checklist Progress */}
      {lead.checklist_total > 0 && (
        <div className="mb-3 space-y-1.5">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground font-medium">
            <span>Tasks</span>
            <span>{lead.checklist_completed}/{lead.checklist_total} ({progress}%)</span>
          </div>
          <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
            <div 
              className="h-full bg-primary transition-all duration-500 ease-in-out" 
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Footer row */}
      <div className="mt-2 flex items-center justify-between pt-2 border-t border-border/50">
        <div className={`flex items-center gap-1.5 text-[10px] ${urgencyClass}`}>
          <Clock className="h-3 w-3" />
          <span>{days === 0 ? "Today" : `${days}d`}</span>
        </div>

        {lead.assigned_to && (
          <div
            className="h-5 w-5 rounded-full bg-muted border border-border flex items-center justify-center text-[9px] font-bold text-muted-foreground"
            title={`Assigned to user: ${lead.assigned_to}`}
          >
            {getInitials(lead.first_name)}
          </div>
        )}
      </div>
    </div>
  );
}

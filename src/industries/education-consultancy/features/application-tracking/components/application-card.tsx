"use client";

import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Calendar, GraduationCap, MapPin } from "lucide-react";
import type { Application } from "@/types/database";

interface ApplicationCardProps {
  application: Application;
  disabled: boolean;
  onOpenDetail?: (app: Application) => void;
}

function formatDate(dateString: string | null): string {
  if (!dateString) return "";
  return new Date(dateString).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getStudentName(app: Application): string {
  const lead = app.leads as { first_name: string | null; last_name: string | null } | null;
  if (!lead) return "Unknown Student";
  return [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Unknown Student";
}

export function ApplicationCard({ application, disabled, onOpenDetail }: ApplicationCardProps) {
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
    opacity: isDragging ? 0.4 : 1,
  };

  const leadId = (application.leads as { id?: string } | null)?.id ?? application.lead_id;

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
      className={`bg-card rounded-lg border p-3 space-y-2 shadow-sm ${
        disabled ? "cursor-default" : "cursor-grab active:cursor-grabbing"
      } hover:border-primary/40 transition-colors`}
    >
      <div className="flex items-start justify-between gap-1">
        {/* Student name → /leads/[id]; stopPropagation keeps card click from also navigating */}
        <Link
          href={`/leads/${leadId}`}
          onClick={(e) => e.stopPropagation()}
          className="text-sm font-semibold text-foreground hover:text-primary line-clamp-1 leading-snug flex-1"
        >
          {getStudentName(application)}
        </Link>
      </div>

      <div className="space-y-1">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <GraduationCap className="h-3 w-3 shrink-0" />
          <span className="truncate">{application.university_name}</span>
        </div>
        <div className="text-xs text-muted-foreground truncate pl-[18px]">{application.program_name}</div>
        {application.intake_term && (
          <div className="text-xs text-muted-foreground truncate pl-[18px]">{application.intake_term}</div>
        )}
        {application.country && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{application.country}</span>
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
        <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
          application.offer_type === "unconditional"
            ? "bg-teal-100 text-teal-700"
            : "bg-yellow-100 text-yellow-700"
        }`}>
          {application.offer_type === "unconditional" ? "Unconditional Offer" : "Conditional Offer"}
        </span>
      )}
    </div>
  );
}

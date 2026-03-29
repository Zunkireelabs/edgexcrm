"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Mail,
  Phone,
  MapPin,
  ExternalLink,
  Copy,
  CheckSquare,
  Square,
  Globe,
  Calendar,
  User,
  FileText,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { Lead, LeadNote, LeadChecklist, PipelineStage } from "@/types/database";

interface LeadPreviewPanelProps {
  lead: Lead | null;
  onClose: () => void;
  stages?: PipelineStage[];
  memberMap?: Record<string, string>;
}

// Generate consistent color from string
function stringToColor(str: string): string {
  const colors = [
    "bg-blue-600",
    "bg-purple-600",
    "bg-pink-600",
    "bg-orange-600",
    "bg-green-600",
    "bg-indigo-600",
    "bg-rose-600",
    "bg-cyan-600",
    "bg-amber-600",
    "bg-teal-600",
  ];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function getInitials(firstName?: string | null, lastName?: string | null): string {
  const first = firstName?.charAt(0)?.toUpperCase() || "";
  const last = lastName?.charAt(0)?.toUpperCase() || "";
  return first + last || "?";
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function LeadPreviewPanel({
  lead,
  onClose,
  stages = [],
  memberMap = {},
}: LeadPreviewPanelProps) {
  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [checklists, setChecklists] = useState<LeadChecklist[]>([]);
  const [loadingExtras, setLoadingExtras] = useState(false);

  // Fetch notes and checklists when lead changes
  useEffect(() => {
    if (lead) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoadingExtras(true);
      Promise.all([
        fetch(`/api/v1/leads/${lead.id}/notes`).then((r) => r.ok ? r.json() : { data: [] }),
        fetch(`/api/v1/leads/${lead.id}/checklists`).then((r) => r.ok ? r.json() : { data: [] }),
      ])
        .then(([notesRes, checklistsRes]) => {
          setNotes(notesRes.data || []);
          setChecklists(checklistsRes.data || []);
        })
        .catch(() => {
          // Silently fail
        })
        .finally(() => setLoadingExtras(false));
    } else {
      setNotes([]);
      setChecklists([]);
    }
  }, [lead]);

  // Handle Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!lead) return null;

  const currentStage = stages.find((s) => s.id === lead.stage_id);
  const avatarColor = stringToColor(`${lead.first_name}${lead.last_name}${lead.email}`);
  const initials = getInitials(lead.first_name, lead.last_name);
  const assignedEmail = lead.assigned_to ? memberMap[lead.assigned_to] : null;
  const completedCount = checklists.filter((c) => c.is_completed).length;
  const latestNote = notes[0];

  const copyEmail = () => {
    if (lead.email) {
      navigator.clipboard.writeText(lead.email);
      toast.success("Email copied");
    }
  };

  return (
    <div className="w-[380px] shrink-0 bg-white border border-gray-200 rounded-lg flex flex-col h-full overflow-hidden shadow-sm mr-6">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <h2 className="text-base font-semibold text-gray-900">Preview</h2>
        <button
          onClick={onClose}
          className="p-1 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* View Record / Actions Row */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
        <Link
          href={`/leads/${lead.id}`}
          className="text-sm text-primary hover:underline flex items-center gap-1"
        >
          View record
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Lead Header with Avatar */}
        <div className="px-4 py-4">
          <div className="flex items-start gap-3">
            <div
              className={`h-12 w-12 rounded-full flex items-center justify-center text-white text-lg font-semibold shrink-0 ${avatarColor}`}
            >
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-semibold text-gray-900 truncate">
                {lead.first_name} {lead.last_name}
              </h3>
              {lead.email && (
                <div className="flex items-center gap-1 mt-0.5">
                  <a
                    href={`mailto:${lead.email}`}
                    className="text-sm text-primary hover:underline truncate"
                  >
                    {lead.email}
                  </a>
                  <button
                    onClick={copyEmail}
                    className="p-0.5 text-gray-400 hover:text-gray-600"
                    title="Copy email"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-2 mt-4">
            {lead.phone && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                asChild
              >
                <a href={`tel:${lead.phone}`}>
                  <Phone className="h-3.5 w-3.5" />
                  Call
                </a>
              </Button>
            )}
            {lead.email && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                asChild
              >
                <a href={`mailto:${lead.email}`}>
                  <Mail className="h-3.5 w-3.5" />
                  Email
                </a>
              </Button>
            )}
          </div>
        </div>

        {/* Metadata Grid */}
        <div className="px-4 py-3 border-t border-gray-100">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            {/* Status */}
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Status</p>
              <Badge
                variant="secondary"
                className="text-xs"
                style={
                  currentStage
                    ? { backgroundColor: `${currentStage.color}20`, color: currentStage.color }
                    : undefined
                }
              >
                {currentStage?.name || lead.status}
              </Badge>
            </div>

            {/* Assigned To */}
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Assigned</p>
              <div className="flex items-center gap-1.5 text-sm text-gray-700">
                <User className="h-3.5 w-3.5 text-gray-400" />
                <span className="truncate">
                  {assignedEmail ? assignedEmail.split("@")[0] : "Unassigned"}
                </span>
              </div>
            </div>

            {/* Source */}
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Source</p>
              <div className="flex items-center gap-1.5 text-sm text-gray-700">
                <Globe className="h-3.5 w-3.5 text-gray-400" />
                <span>{lead.intake_source || "—"}</span>
              </div>
            </div>

            {/* Location */}
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Location</p>
              <div className="flex items-center gap-1.5 text-sm text-gray-700">
                <MapPin className="h-3.5 w-3.5 text-gray-400" />
                <span className="truncate">
                  {lead.city || lead.country
                    ? `${lead.city || ""}${lead.city && lead.country ? ", " : ""}${lead.country || ""}`
                    : "—"}
                </span>
              </div>
            </div>

            {/* Created */}
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Created</p>
              <div className="flex items-center gap-1.5 text-sm text-gray-700">
                <Calendar className="h-3.5 w-3.5 text-gray-400" />
                <span>{new Date(lead.created_at).toLocaleDateString()}</span>
              </div>
            </div>

            {/* Phone */}
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Phone</p>
              <div className="flex items-center gap-1.5 text-sm">
                <Phone className="h-3.5 w-3.5 text-gray-400" />
                {lead.phone ? (
                  <a href={`tel:${lead.phone}`} className="text-primary hover:underline truncate">
                    {lead.phone}
                  </a>
                ) : (
                  <span className="text-gray-700">—</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Checklist Section */}
        <div className="px-4 py-3 border-t border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-gray-900 flex items-center gap-2">
              <CheckSquare className="h-4 w-4 text-gray-500" />
              Checklist
            </h4>
            {checklists.length > 0 && (
              <span className="text-xs text-gray-500">
                {completedCount}/{checklists.length} done
              </span>
            )}
          </div>

          {loadingExtras ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-3/4" />
            </div>
          ) : checklists.length === 0 ? (
            <p className="text-sm text-gray-500">No checklist items</p>
          ) : (
            <div className="space-y-1">
              {checklists.slice(0, 4).map((item) => (
                <div key={item.id} className="flex items-center gap-2 text-sm">
                  {item.is_completed ? (
                    <CheckSquare className="h-4 w-4 text-green-600 shrink-0" />
                  ) : (
                    <Square className="h-4 w-4 text-gray-400 shrink-0" />
                  )}
                  <span className={item.is_completed ? "line-through text-gray-400" : "text-gray-700"}>
                    {item.title}
                  </span>
                </div>
              ))}
              {checklists.length > 4 && (
                <p className="text-xs text-gray-500 pl-6">
                  +{checklists.length - 4} more items
                </p>
              )}
            </div>
          )}
        </div>

        {/* Latest Note Section */}
        <div className="px-4 py-3 border-t border-gray-100">
          <h4 className="text-sm font-medium text-gray-900 flex items-center gap-2 mb-2">
            <FileText className="h-4 w-4 text-gray-500" />
            Latest Note
          </h4>

          {loadingExtras ? (
            <Skeleton className="h-16 w-full" />
          ) : !latestNote ? (
            <p className="text-sm text-gray-500">No notes yet</p>
          ) : (
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-sm text-gray-700 line-clamp-3">{latestNote.content}</p>
              <p className="text-xs text-gray-500 mt-2">
                — {latestNote.user_email?.split("@")[0]}, {formatRelativeTime(latestNote.created_at)}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-gray-200 bg-gray-50">
        <Button variant="outline" size="sm" className="w-full h-9" asChild>
          <Link href={`/leads/${lead.id}`}>
            <ExternalLink className="h-4 w-4 mr-2" />
            Open Full View
          </Link>
        </Button>
      </div>
    </div>
  );
}

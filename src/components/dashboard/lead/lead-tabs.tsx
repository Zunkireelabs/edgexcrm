"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AISparkleIcon } from "@/components/ui/ai-sparkle";
import type { Lead, LeadNote } from "@/types/database";
import type { LeadActivity } from "@/lib/supabase/queries";
import { NotesTab } from "./notes-tab";
import { AIInsightsTab } from "./ai-insights-tab";
import { ProfessionalDetailsCard } from "./professional-details-card";
import { ActivitiesPanel } from "./activities/activities-panel";

interface LeadTabsProps {
  lead: Lead;
  notes: LeadNote[];
  activities: LeadActivity[];
  teamMemberEmails: Record<string, string>;
  customFields: Record<string, unknown>;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onNotesChange: (notes: LeadNote[]) => void;
  onCustomFieldsChange: (fields: Record<string, unknown>) => void;
  isAdmin: boolean;
  currentUserId: string;
  industryId?: string | null;
}

export interface LeadTabsRef {
  focusComposer: () => void;
}

export const LeadTabs = forwardRef<LeadTabsRef, LeadTabsProps>(
  function LeadTabs(
    { lead, notes, activities, teamMemberEmails, customFields, activeTab, onTabChange, onNotesChange, onCustomFieldsChange, isAdmin, currentUserId, industryId },
    ref
  ) {
    const notesTabRef = useRef<{ focusComposer: () => void }>(null);

    useImperativeHandle(ref, () => ({
      focusComposer: () => {
        notesTabRef.current?.focusComposer();
      },
    }));

    const location = [lead.city, lead.country].filter(Boolean).join(", ");

    return (
      <Tabs value={activeTab} onValueChange={onTabChange}>
        <TabsList className="mb-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="notes" className="gap-2">
            Notes
            {notes.length > 0 && (
              <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                {notes.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="activity" className="gap-2">
            Activity
            {activities.length > 0 && (
              <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                {activities.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="ai-insights" className="gap-1.5">
            <AISparkleIcon className="size-4" />
            AI Insights
            <Badge variant="secondary" className="h-4 px-1 text-[10px] font-medium bg-purple-100 text-purple-700">
              Beta
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 mt-0">
          {/* Personal Information */}
          <Card className="shadow-none rounded-lg py-0">
            <CardHeader className="pt-4 pb-3">
              <CardTitle className="text-base">Personal Information</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 pb-4">
              <InfoGridRow label="Full Name" value={`${lead.first_name || ""} ${lead.last_name || ""}`.trim() || "—"} />
              {industryId === "education_consultancy" && (
                <InfoGridRow
                  label="Tag"
                  value={
                    <TagSelector
                      leadId={lead.id}
                      currentTags={lead.tags || []}
                    />
                  }
                />
              )}
              <InfoGridRow label="Email" value={lead.email} isLink linkType="email" />
              <InfoGridRow label="Phone" value={lead.phone} isLink linkType="phone" />
              {location && <InfoGridRow label="Location" value={location} />}
              {lead.preferred_contact_method && (
                <InfoGridRow
                  label="Preferred Contact"
                  value={lead.preferred_contact_method.charAt(0).toUpperCase() + lead.preferred_contact_method.slice(1)}
                />
              )}
            </CardContent>
          </Card>

          {/* Professional Details (editable) */}
          <ProfessionalDetailsCard
            leadId={lead.id}
            customFields={customFields}
            onFieldsUpdate={onCustomFieldsChange}
            isAdmin={isAdmin}
          />

          {/* Recent Notes Preview */}
          {notes.length > 0 && (
            <Card className="shadow-none rounded-lg py-0">
              <CardHeader className="pt-4 pb-3">
                <CardTitle className="text-base">Recent Notes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pb-4">
                {notes.slice(0, 2).map((note) => (
                  <div key={note.id} className="border-l-2 border-muted pl-3 py-1">
                    <p className="text-sm text-foreground line-clamp-2">{note.content}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {note.user_email} · {formatRelativeTime(note.created_at)}
                    </p>
                  </div>
                ))}
                {notes.length > 2 && (
                  <button
                    type="button"
                    className="text-sm text-primary hover:underline"
                    onClick={() => onTabChange("notes")}
                  >
                    View all {notes.length} notes →
                  </button>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="notes" className="mt-0">
          <NotesTab
            ref={notesTabRef}
            leadId={lead.id}
            notes={notes}
            onNotesChange={onNotesChange}
          />
        </TabsContent>

        <TabsContent value="activity" className="mt-0">
          <ActivitiesPanel
            leadId={lead.id}
            notes={notes}
            systemActivities={activities}
            teamMemberEmails={teamMemberEmails}
            isAdmin={isAdmin}
            onNotesChange={onNotesChange}
            currentUserId={currentUserId}
          />
        </TabsContent>

        <TabsContent value="ai-insights" className="mt-0">
          <AIInsightsTab lead={lead} notes={notes} />
        </TabsContent>
      </Tabs>
    );
  }
);

// Helper components
interface InfoGridRowProps {
  label: string;
  value: React.ReactNode | string | null | undefined;
  isLink?: boolean;
  linkType?: "email" | "phone";
}

function InfoGridRow({ label, value, isLink, linkType }: InfoGridRowProps) {
  if (!value) return null;

  const displayValue = isLink && typeof value === "string" ? (
    <a
      href={linkType === "email" ? `mailto:${value}` : `tel:${value}`}
      className="text-primary hover:underline"
    >
      {value}
    </a>
  ) : (
    value
  );

  return (
    <div className="grid grid-cols-[140px_1fr] gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{displayValue}</span>
    </div>
  );
}

function TagSelector({ leadId, currentTags }: { leadId: string; currentTags: string[] }) {
  const [tags, setTags] = useState(currentTags);
  const [updating, setUpdating] = useState(false);

  async function handleToggle(tag: string) {
    setUpdating(true);
    const newTags = [tag];
    try {
      const res = await fetch(`/api/v1/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: newTags }),
      });
      if (res.ok) {
        setTags(newTags);
        toast.success(`Tagged as ${tag}`);
      }
    } catch {
      toast.error("Failed to update tag");
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="flex gap-1.5">
      {["student", "parent"].map((tag) => (
        <button
          key={tag}
          disabled={updating}
          onClick={() => handleToggle(tag)}
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold transition-colors cursor-pointer ${
            tags.includes(tag)
              ? tag === "parent"
                ? "bg-green-100 text-green-700 ring-2 ring-green-300"
                : "bg-blue-100 text-blue-700 ring-2 ring-blue-300"
              : "bg-gray-100 text-gray-400 hover:bg-gray-200"
          }`}
        >
          {tag.charAt(0).toUpperCase() + tag.slice(1)}
        </button>
      ))}
    </div>
  );
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

"use client";

import { useState } from "react";
import { ChevronDown, UserCircle, Building } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Lead, PipelineStage, TenantEntity, Industry } from "@/types/database";

interface TeamMember {
  id: string;
  user_id: string;
  role: string;
  email: string;
}

interface KeyInfoSectionProps {
  lead: Lead;
  stages: PipelineStage[];
  currentStage?: PipelineStage;
  stageId: string | null;
  assignedTo: string;
  teamMembers: TeamMember[];
  isAdmin: boolean;
  onStageChange: (stageId: string) => void;
  onAssignmentChange: (userId: string) => void;
  entity?: TenantEntity | null;
  industry?: Industry | null;
}

export function KeyInfoSection({
  lead,
  stages,
  currentStage,
  stageId,
  assignedTo,
  teamMembers,
  isAdmin,
  onStageChange,
  onAssignmentChange,
  entity,
  industry,
}: KeyInfoSectionProps) {
  const [isOpen, setIsOpen] = useState(true);

  const location = [lead.city, lead.country].filter(Boolean).join(", ");
  const assignedMember = teamMembers.find((m) => m.user_id === assignedTo);
  const hasIntakeInfo = lead.intake_source || lead.intake_medium || lead.intake_campaign;
  const entityLabel = industry?.entity_type_singular || "Entity";

  // Custom fields
  const customFields = Object.entries(lead.custom_fields || {}).filter(
    ([, v]) => v != null && v !== ""
  );

  return (
    <div className="border border-border rounded-lg bg-card shadow-none">
      <button
        type="button"
        className="flex items-center justify-between w-full p-3 text-left"
        onClick={() => setIsOpen(!isOpen)}
      >
        <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
          Key Information
        </h3>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform duration-200",
            isOpen && "rotate-180"
          )}
        />
      </button>

      {isOpen && (
        <div className="px-3 pb-3 pt-0 space-y-4">
          {/* Stage */}
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Stage</p>
            {isAdmin ? (
              <Select value={stageId || ""} onValueChange={onStageChange}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Select stage" />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((stage) => (
                    <SelectItem key={stage.id} value={stage.id}>
                      <div className="flex items-center gap-2">
                        <div
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: stage.color }}
                        />
                        {stage.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Badge
                variant="secondary"
                style={
                  currentStage
                    ? { backgroundColor: `${currentStage.color}20`, color: currentStage.color }
                    : undefined
                }
              >
                {currentStage?.name || "Unknown"}
              </Badge>
            )}
          </div>

          {/* Assigned To */}
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Assigned To</p>
            {isAdmin ? (
              <Select
                value={assignedTo || "unassigned"}
                onValueChange={onAssignmentChange}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">
                    <span className="text-muted-foreground">Unassigned</span>
                  </SelectItem>
                  {teamMembers
                    .filter((m) => m.role !== "viewer")
                    .map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>
                        <div className="flex items-center gap-2">
                          <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center">
                            <span className="text-[10px] font-medium text-primary">
                              {getInitials(m.email)}
                            </span>
                          </div>
                          <span className="truncate">{m.email}</span>
                        </div>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex items-center gap-2">
                {assignedMember ? (
                  <>
                    <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center">
                      <span className="text-[10px] font-medium text-primary">
                        {getInitials(assignedMember.email)}
                      </span>
                    </div>
                    <span className="text-sm font-medium truncate">{assignedMember.email}</span>
                  </>
                ) : (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <UserCircle className="h-4 w-4" />
                    <span className="text-sm">Unassigned</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Entity (e.g., College, Service, Project Type) */}
          {entity && (
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">{entityLabel}</p>
              <div className="flex items-center gap-2">
                <div className="h-6 w-6 rounded-md bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                  <Building className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                </div>
                <span className="text-sm font-medium">{entity.name}</span>
              </div>
              {entity.description && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  {entity.description}
                </p>
              )}
            </div>
          )}

          {/* Divider */}
          <div className="border-t border-border" />

          {/* Location */}
          {location && (
            <InfoRow label="Location" value={location} />
          )}

          {/* Preferred Contact */}
          {lead.preferred_contact_method && (
            <InfoRow
              label="Preferred Contact"
              value={lead.preferred_contact_method.charAt(0).toUpperCase() + lead.preferred_contact_method.slice(1)}
            />
          )}

          {/* Created */}
          <InfoRow
            label="Created"
            value={new Date(lead.created_at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          />

          {/* Last Updated */}
          <InfoRow
            label="Last Updated"
            value={formatRelativeTime(lead.updated_at)}
          />

          {/* Intake Details */}
          {hasIntakeInfo && (
            <>
              <div className="border-t border-border" />
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                Intake Details
              </p>
              {lead.intake_source && (
                <InfoRow label="Source" value={lead.intake_source} />
              )}
              {lead.intake_medium && (
                <InfoRow label="Medium" value={lead.intake_medium} />
              )}
              {lead.intake_campaign && (
                <InfoRow label="Campaign" value={lead.intake_campaign} />
              )}
            </>
          )}

          {/* Custom Fields */}
          {customFields.length > 0 && (
            <>
              <div className="border-t border-border" />
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                Additional Details
              </p>
              {customFields.map(([key, value]) => (
                <InfoRow
                  key={key}
                  label={formatFieldLabel(key)}
                  value={String(value)}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Helper components
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

// Utility functions
function getInitials(email: string): string {
  const name = email.split("@")[0];
  const parts = name.split(/[._-]/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
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
      return diffMinutes <= 1 ? "Just now" : `${diffMinutes} minutes ago`;
    }
    return diffHours === 1 ? "1 hour ago" : `${diffHours} hours ago`;
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatFieldLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

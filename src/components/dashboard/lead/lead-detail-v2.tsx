"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { Lead, LeadNote, LeadChecklist, PipelineStage, Tenant, TenantEntity, Industry } from "@/types/database";
import type { LeadActivity } from "@/lib/supabase/queries";

import { ContactCard } from "./contact-card";
import { KeyInfoSection } from "./key-info-section";
import { LeadTabs } from "./lead-tabs";
import { ManagementPanel } from "./management-panel";

interface TeamMember {
  id: string;
  user_id: string;
  role: string;
  email: string;
}

interface LeadDetailV2Props {
  lead: Lead;
  notes: LeadNote[];
  checklists: LeadChecklist[];
  activities: LeadActivity[];
  stages: PipelineStage[];
  tenant: Tenant;
  role: string;
  userId: string;
  entity?: TenantEntity | null;
  industry?: Industry | null;
}

export function LeadDetailV2({
  lead,
  notes: initialNotes,
  checklists: initialChecklists,
  activities,
  stages,
  tenant: _tenant,
  role,
  userId: _userId,
  entity,
  industry,
}: LeadDetailV2Props) {
  const router = useRouter();
  const notesTabRef = useRef<{ focusComposer: () => void }>(null);
  const checklistRef = useRef<{ focusInput: () => void }>(null);

  const [notes, setNotes] = useState(initialNotes);
  const [checklists, setChecklists] = useState(initialChecklists);
  const [_status, setStatus] = useState(lead.status);
  const [stageId, setStageId] = useState(lead.stage_id);
  const [assignedTo, setAssignedTo] = useState(lead.assigned_to || "");
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");

  const isAdmin = role === "owner" || role === "admin";
  const currentStage = stages.find((s) => s.id === stageId);

  // Computed values for tabs
  const customFields = Object.entries(lead.custom_fields || {}).filter(
    ([, v]) => v != null && v !== ""
  );

  // Create email lookup map for activity display
  const teamMemberEmails = teamMembers.reduce<Record<string, string>>(
    (acc, member) => {
      acc[member.user_id] = member.email;
      return acc;
    },
    {}
  );

  // Fetch team members for assignment
  const fetchTeamMembers = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/team");
      if (res.ok) {
        const json = await res.json();
        setTeamMembers(json.data || []);
      }
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    if (isAdmin) {
      fetchTeamMembers();
    }
  }, [isAdmin, fetchTeamMembers]);

  // Handlers
  const handleNoteClick = () => {
    setActiveTab("notes");
    setTimeout(() => {
      notesTabRef.current?.focusComposer();
    }, 100);
  };

  const handleTaskClick = () => {
    setTimeout(() => {
      checklistRef.current?.focusInput();
    }, 100);
  };

  const handleStageChange = async (newStageId: string) => {
    const newStage = stages.find((s) => s.id === newStageId);
    if (!newStage) return;

    setStageId(newStageId);
    setStatus(newStage.slug);

    try {
      const res = await fetch(`/api/v1/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStage.slug }),
      });
      if (!res.ok) throw new Error("Failed to update stage");
      toast.success("Stage updated");
    } catch {
      toast.error("Failed to update stage");
      setStageId(lead.stage_id);
      setStatus(lead.status);
    }
  };

  const handleAssignmentChange = async (newUserId: string) => {
    const value = newUserId === "unassigned" ? null : newUserId;
    setAssignedTo(value || "");

    try {
      const res = await fetch(`/api/v1/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigned_to: value }),
      });
      if (!res.ok) throw new Error();
      toast.success("Assignment updated");
    } catch {
      toast.error("Failed to update assignment");
      setAssignedTo(lead.assigned_to || "");
    }
  };

  const handleDeleteLead = async () => {
    if (!confirm("Are you sure you want to delete this lead? This cannot be undone.")) return;
    setDeleting(true);

    try {
      const res = await fetch(`/api/v1/leads/${lead.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete lead");
      toast.success("Lead deleted");
      router.push("/leads");
      router.refresh();
    } catch {
      toast.error("Failed to delete lead");
      setDeleting(false);
    }
  };

  const handleNotesChange = (newNotes: LeadNote[]) => {
    setNotes(newNotes);
  };

  const handleChecklistsChange = (newChecklists: LeadChecklist[]) => {
    setChecklists(newChecklists);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/leads">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">
              {lead.first_name} {lead.last_name}
            </h1>
            <p className="text-sm text-muted-foreground">
              Submitted {new Date(lead.created_at).toLocaleDateString()} at{" "}
              {new Date(lead.created_at).toLocaleTimeString()}
            </p>
          </div>
        </div>
        {isAdmin && (
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDeleteLead}
            disabled={deleting}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {deleting ? "Deleting..." : "Delete"}
          </Button>
        )}
      </div>

      {/* 3-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] xl:grid-cols-[280px_1fr_320px] gap-6">
        {/* Left Sidebar */}
        <div className="space-y-4">
          {/* Contact Card */}
          <ContactCard
            lead={lead}
            currentStage={currentStage}
            onNoteClick={handleNoteClick}
            onTaskClick={handleTaskClick}
          />

          {/* Key Information (includes Stage, Assigned To, and all lead details) */}
          <KeyInfoSection
            lead={lead}
            stages={stages}
            currentStage={currentStage}
            stageId={stageId}
            assignedTo={assignedTo}
            teamMembers={teamMembers}
            isAdmin={isAdmin}
            onStageChange={handleStageChange}
            onAssignmentChange={handleAssignmentChange}
            entity={entity}
            industry={industry}
          />
        </div>

        {/* Center Content */}
        <div className="min-w-0">
          <LeadTabs
            ref={notesTabRef}
            lead={lead}
            notes={notes}
            activities={activities}
            teamMemberEmails={teamMemberEmails}
            customFields={customFields}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onNotesChange={handleNotesChange}
            isAdmin={isAdmin}
          />
        </div>

        {/* Right Sidebar */}
        <div className="lg:col-span-full xl:col-span-1">
          <ManagementPanel
            ref={checklistRef}
            lead={lead}
            checklists={checklists}
            isAdmin={isAdmin}
            onChecklistsChange={handleChecklistsChange}
          />
        </div>
      </div>
    </div>
  );
}

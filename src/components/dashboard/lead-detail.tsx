"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Lead, LeadNote, LeadChecklist, PipelineStage, Tenant } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  FileDown,
  Trash2,
  Send,
  UserCircle,
  CheckSquare,
  Square,
  Plus,
  Globe,
  Megaphone,
} from "lucide-react";
import { toast } from "sonner";


interface TeamMember {
  id: string;
  user_id: string;
  role: string;
  email: string;
}

interface LeadDetailProps {
  lead: Lead;
  notes: LeadNote[];
  checklists: LeadChecklist[];
  stages: PipelineStage[];
  tenant: Tenant;
  role: string;
  userId: string;
}

export function LeadDetail({
  lead,
  notes: initialNotes,
  checklists: initialChecklists,
  stages,
  role,
  userId,
}: LeadDetailProps) {
  const router = useRouter();
  const [status, setStatus] = useState(lead.status);
  const [assignedTo, setAssignedTo] = useState(lead.assigned_to || "");
  const [updating, setUpdating] = useState(false);
  const [notes, setNotes] = useState(initialNotes);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [checklists, setChecklists] = useState(initialChecklists);
  const [newChecklistTitle, setNewChecklistTitle] = useState("");
  const [addingChecklist, setAddingChecklist] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

  const isAdmin = role === "owner" || role === "admin";

  const currentStage = stages.find((s) => s.id === lead.stage_id);

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

  async function updateStatus(newStatus: string) {
    setStatus(newStatus);
    setUpdating(true);
    try {
      const res = await fetch(`/api/v1/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      toast.success("Status updated");
    } catch {
      toast.error("Failed to update status");
      setStatus(lead.status);
    } finally {
      setUpdating(false);
    }
  }

  async function updateAssignment(newUserId: string) {
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
  }

  async function addNote() {
    if (!newNote.trim()) return;
    setAddingNote(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from("lead_notes")
      .insert({
        lead_id: lead.id,
        user_id: user!.id,
        user_email: user!.email!,
        content: newNote.trim(),
      })
      .select()
      .single();

    setAddingNote(false);
    if (error) {
      toast.error("Failed to add note");
    } else {
      setNotes([data as LeadNote, ...notes]);
      setNewNote("");
      toast.success("Note added");
    }
  }

  async function addChecklistItem() {
    if (!newChecklistTitle.trim()) return;
    setAddingChecklist(true);
    try {
      const res = await fetch(`/api/v1/leads/${lead.id}/checklists`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newChecklistTitle.trim() }),
      });
      if (!res.ok) throw new Error();
      const json = await res.json();
      setChecklists([...checklists, json.data as LeadChecklist]);
      setNewChecklistTitle("");
      toast.success("Checklist item added");
    } catch {
      toast.error("Failed to add checklist item");
    } finally {
      setAddingChecklist(false);
    }
  }

  async function toggleChecklist(item: LeadChecklist) {
    const newCompleted = !item.is_completed;
    // Optimistic update
    setChecklists((prev) =>
      prev.map((c) =>
        c.id === item.id ? { ...c, is_completed: newCompleted } : c
      )
    );
    try {
      const res = await fetch(
        `/api/v1/leads/${lead.id}/checklists/${item.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_completed: newCompleted }),
        }
      );
      if (!res.ok) throw new Error();
    } catch {
      // Revert
      setChecklists((prev) =>
        prev.map((c) =>
          c.id === item.id ? { ...c, is_completed: item.is_completed } : c
        )
      );
      toast.error("Failed to update checklist");
    }
  }

  async function deleteChecklistItem(itemId: string) {
    setChecklists((prev) => prev.filter((c) => c.id !== itemId));
    try {
      const res = await fetch(
        `/api/v1/leads/${lead.id}/checklists/${itemId}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error();
    } catch {
      toast.error("Failed to delete checklist item");
      // Re-fetch to restore
      try {
        const res = await fetch(`/api/v1/leads/${lead.id}/checklists`);
        if (res.ok) {
          const json = await res.json();
          setChecklists(json.data || []);
        }
      } catch {
        // ignore
      }
    }
  }

  async function deleteLead() {
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
  }

  const fileUrls = lead.file_urls || {};
  const customFields = lead.custom_fields || {};
  const assignedMember = teamMembers.find((m) => m.user_id === assignedTo);

  const completedCount = checklists.filter((c) => c.is_completed).length;

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
            onClick={deleteLead}
            disabled={deleting}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {deleting ? "Deleting..." : "Delete"}
          </Button>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Personal Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Personal Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {lead.email && (
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <a
                  href={`mailto:${lead.email}`}
                  className="text-sm text-blue-600 hover:underline"
                >
                  {lead.email}
                </a>
              </div>
            )}
            {lead.phone && (
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <a
                  href={`tel:${lead.phone}`}
                  className="text-sm text-blue-600 hover:underline"
                >
                  {lead.phone}
                </a>
              </div>
            )}
            {(lead.city || lead.country) && (
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">
                  {lead.city}
                  {lead.country ? `, ${lead.country}` : ""}
                </span>
              </div>
            )}
            {Object.entries(customFields).length > 0 && (
              <>
                <hr className="my-2" />
                {Object.entries(customFields).map(([key, value]) => (
                  <div key={key} className="flex justify-between text-sm">
                    <span className="text-muted-foreground capitalize">
                      {key.replace(/_/g, " ")}
                    </span>
                    <span>{String(value)}</span>
                  </div>
                ))}
              </>
            )}
          </CardContent>
        </Card>

        {/* Status + Assignment */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Status & Stage</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Badge
                  variant="secondary"
                  className="text-sm"
                  style={
                    currentStage
                      ? { backgroundColor: `${currentStage.color}20`, color: currentStage.color }
                      : undefined
                  }
                >
                  {currentStage?.name || status}
                </Badge>
              </div>
              {isAdmin && (
                <Select
                  value={status}
                  onValueChange={updateStatus}
                  disabled={updating}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {stages.map((stage) => (
                      <SelectItem key={stage.slug} value={stage.slug}>
                        {stage.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </CardContent>
          </Card>

          {/* Assignment */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <UserCircle className="h-5 w-5" />
                Assigned To
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isAdmin ? (
                <Select
                  value={assignedTo || "unassigned"}
                  onValueChange={updateAssignment}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {teamMembers
                      .filter((m) => m.role !== "viewer")
                      .map((m) => (
                        <SelectItem key={m.user_id} value={m.user_id}>
                          {m.email} ({m.role})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm">
                  {assignedMember ? assignedMember.email : assignedTo ? "Assigned" : "Unassigned"}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Documents */}
          {Object.keys(fileUrls).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Documents</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {Object.entries(fileUrls).map(([key, url]) => (
                  <a
                    key={key}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 p-2 rounded-md hover:bg-muted transition-colors text-sm"
                  >
                    <FileDown className="h-4 w-4 text-muted-foreground" />
                    <span className="capitalize">{key.replace(/_/g, " ")}</span>
                  </a>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Intake Information */}
      {(lead.intake_source || lead.intake_medium || lead.intake_campaign || lead.preferred_contact_method) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Megaphone className="h-5 w-5" />
              Intake Information
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-2 gap-3">
              {lead.intake_source && (
                <div className="flex items-center gap-2 text-sm">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Source:</span>
                  <span>{lead.intake_source}</span>
                </div>
              )}
              {lead.intake_medium && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Medium: </span>
                  <span>{lead.intake_medium}</span>
                </div>
              )}
              {lead.intake_campaign && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Campaign: </span>
                  <span>{lead.intake_campaign}</span>
                </div>
              )}
              {lead.preferred_contact_method && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Preferred Contact: </span>
                  <span className="capitalize">{lead.preferred_contact_method}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Checklists */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <CheckSquare className="h-5 w-5" />
            Checklist
          </CardTitle>
          <CardDescription>
            {completedCount}/{checklists.length} completed
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {checklists.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between py-1.5 border-b last:border-0"
            >
              <button
                className="flex items-center gap-2 text-sm hover:text-foreground transition-colors text-left"
                onClick={() => toggleChecklist(item)}
              >
                {item.is_completed ? (
                  <CheckSquare className="h-4 w-4 text-green-600 shrink-0" />
                ) : (
                  <Square className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <span className={item.is_completed ? "line-through text-muted-foreground" : ""}>
                  {item.title}
                </span>
              </button>
              {isAdmin && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => deleteChecklistItem(item.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
          {checklists.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-2">
              No checklist items yet
            </p>
          )}
          {isAdmin && (
            <div className="flex gap-2 pt-2">
              <Input
                placeholder="Add checklist item..."
                value={newChecklistTitle}
                onChange={(e) => setNewChecklistTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addChecklistItem()}
                className="text-sm"
              />
              <Button
                size="icon"
                variant="outline"
                onClick={addChecklistItem}
                disabled={addingChecklist || !newChecklistTitle.trim()}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Notes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Internal Notes</CardTitle>
          <CardDescription>Notes are only visible to your team</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Textarea
              placeholder="Add a note..."
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              className="min-h-[80px]"
            />
            <Button
              onClick={addNote}
              disabled={addingNote || !newNote.trim()}
              size="icon"
              className="self-end"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          {notes.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No notes yet
            </p>
          ) : (
            <div className="space-y-3">
              {notes.map((note) => (
                <div key={note.id} className="border rounded-md p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">{note.user_email}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(note.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm">{note.content}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

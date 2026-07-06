"use client";

import { useState, useEffect, useCallback } from "react";
import { X, UserPlus } from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

interface Collaborator {
  user_id: string;
  email: string;
  name: string;
}

interface TeamMember {
  user_id: string;
  email: string;
  name?: string | null;
}

interface CollaboratorsBlockProps {
  leadId: string;
  teamMembers?: TeamMember[];
}

export function CollaboratorsBlock({ leadId, teamMembers = [] }: CollaboratorsBlockProps) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [adding, setAdding] = useState(false);

  const fetchCollaborators = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/collaborators`);
      const json = await res.json();
      if (res.ok) setCollaborators(json.data?.collaborators ?? []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    fetchCollaborators();
  }, [fetchCollaborators]);

  async function handleAdd() {
    if (!selectedUserId) return;
    setAdding(true);
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/collaborators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: selectedUserId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to add");
      setCollaborators((prev) => [...prev, json.data.collaborator]);
      setSelectedUserId("");
      toast.success("Collaborator added");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add collaborator");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(userId: string) {
    setRemovingId(userId);
    setConfirmId(null);
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/collaborators/${userId}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to remove");
      setCollaborators((prev) => prev.filter((c) => c.user_id !== userId));
      toast.success("Collaborator removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove collaborator");
    } finally {
      setRemovingId(null);
    }
  }

  if (loading) return null;

  const collaboratorIds = new Set(collaborators.map((c) => c.user_id));
  const addableMembers = teamMembers.filter((m) => !collaboratorIds.has(m.user_id));

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-1.5">Lead Collaborators</p>

      {/* Existing collaborators */}
      {collaborators.length > 0 && (
        <div className="flex flex-col gap-1 mb-2">
          {collaborators.map((c) => (
            <div
              key={c.user_id}
              className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 bg-muted/30"
            >
              {confirmId === c.user_id ? (
                <>
                  <span className="text-xs text-muted-foreground flex-1">
                    Remove <span className="font-medium text-foreground">{c.name}</span>?
                  </span>
                  <button
                    onClick={() => handleRemove(c.user_id)}
                    disabled={removingId === c.user_id}
                    className="text-[10px] font-medium text-destructive hover:underline disabled:opacity-50"
                  >
                    {removingId === c.user_id ? "Removing…" : "Yes"}
                  </button>
                  <button
                    onClick={() => setConfirmId(null)}
                    className="text-[10px] font-medium text-muted-foreground hover:underline"
                  >
                    No
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setConfirmId(c.user_id)}
                    disabled={!!removingId}
                    className="flex-shrink-0 rounded-full p-0.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40"
                    aria-label={`Remove ${c.name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-[10px] font-medium text-primary">
                        {(c.name || c.email)[0]?.toUpperCase() ?? "?"}
                      </span>
                    </div>
                    <span className="text-sm truncate">{c.name || c.email.split("@")[0]}</span>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add collaborator */}
      {addableMembers.length > 0 && (
        <div className="flex gap-1.5 items-center">
          <Select value={selectedUserId} onValueChange={setSelectedUserId}>
            <SelectTrigger className="h-7 text-xs flex-1">
              <SelectValue placeholder="Add collaborator…" />
            </SelectTrigger>
            <SelectContent>
              {addableMembers.map((m) => (
                <SelectItem key={m.user_id} value={m.user_id}>
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 rounded-full bg-primary/10 flex items-center justify-center">
                      <span className="text-[9px] font-medium text-primary">
                        {(m.name || m.email)[0]?.toUpperCase() ?? "?"}
                      </span>
                    </div>
                    <span>{m.name || m.email.split("@")[0]}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2"
            disabled={!selectedUserId || adding}
            onClick={handleAdd}
          >
            <UserPlus className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {collaborators.length === 0 && addableMembers.length === 0 && (
        <p className="text-xs text-muted-foreground italic">No team members to add.</p>
      )}
    </div>
  );
}

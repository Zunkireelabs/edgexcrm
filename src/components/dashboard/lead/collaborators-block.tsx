"use client";

import { useState, useEffect, useCallback } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";

interface Collaborator {
  user_id: string;
  email: string;
  name: string;
}

interface CollaboratorsBlockProps {
  leadId: string;
}

export function CollaboratorsBlock({ leadId }: CollaboratorsBlockProps) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const fetchCollaborators = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/collaborators`);
      const json = await res.json();
      if (res.ok) setCollaborators(json.data?.collaborators ?? []);
    } catch {
      // silent — block just shows empty
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    fetchCollaborators();
  }, [fetchCollaborators]);

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
  if (collaborators.length === 0) return null;

  const confirmTarget = confirmId ? collaborators.find((c) => c.user_id === confirmId) : null;

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-1.5">Lead Collaborators</p>
      <div className="flex flex-col gap-1">
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
                  <span className="text-sm truncate">{c.name}</span>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

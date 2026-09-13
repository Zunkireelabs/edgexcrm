"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { MemberAvatar } from "@/components/ui/member-avatar";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelativeTime } from "@/lib/format-relative-time";
import type { TeamMember } from "./task-detail";

export interface TaskComment {
  id: string;
  task_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
}

interface TaskCommentsProps {
  taskId: string;
  currentUserId: string;
  /** Same role-based admin flag TaskDetailBody already carries — matches DELETE's author-or-admin gate. */
  isAdmin: boolean;
  team: TeamMember[];
}

/**
 * Round 2 slice C Phase 2 (docs/IT-AGENCY-ROUND2-TASK-PANEL-BRIEF.md §3.4).
 * Rendered at the bottom of TaskDetailBody on both presentations, ungated by
 * canEdit — any tenant member who can see the task can comment (matches how
 * open both GET endpoints already are).
 */
export function TaskComments({ taskId, currentUserId, isAdmin, team }: TaskCommentsProps) {
  const [loading, setLoading] = useState(true);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/tasks/${taskId}/comments`);
      const json = await res.json().catch(() => ({ data: [] }));
      setComments(res.ok ? ((json.data ?? []) as TaskComment[]) : []);
    } catch {
      setComments([]);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    load();
  }, [load]);

  function nameFor(authorId: string | null): string {
    if (!authorId) return "Former member";
    return team.find((m) => m.user_id === authorId)?.name ?? "Former member";
  }

  async function submit() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    const optimisticId = `optimistic-${Date.now()}`;
    const optimistic: TaskComment = {
      id: optimisticId,
      task_id: taskId,
      author_id: currentUserId,
      body,
      created_at: new Date().toISOString(),
    };
    setComments((prev) => [...prev, optimistic]);
    setDraft("");
    try {
      const res = await fetch(`/api/v1/tasks/${taskId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setComments((prev) => prev.filter((c) => c.id !== optimisticId));
        setDraft(body);
        toast.error(json?.error?.message ?? "Failed to post comment");
        return;
      }
      setComments((prev) => prev.map((c) => (c.id === optimisticId ? (json.data as TaskComment) : c)));
    } catch {
      setComments((prev) => prev.filter((c) => c.id !== optimisticId));
      setDraft(body);
      toast.error("Failed to post comment");
    } finally {
      setSending(false);
    }
  }

  async function remove(id: string) {
    const snapshot = comments;
    setComments((prev) => prev.filter((c) => c.id !== id));
    try {
      const res = await fetch(`/api/v1/tasks/${taskId}/comments/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setComments(snapshot);
        toast.error("Failed to delete comment");
      }
    } catch {
      setComments(snapshot);
      toast.error("Failed to delete comment");
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-medium text-muted-foreground">
        Comments{comments.length > 0 ? ` (${comments.length})` : ""}
      </h3>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-3/4" />
        </div>
      ) : comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet. Start the conversation.</p>
      ) : (
        <div className="space-y-3">
          {comments.map((c) => (
            <div key={c.id} className="group flex items-start gap-2">
              <MemberAvatar userId={c.author_id ?? "former-member"} name={nameFor(c.author_id)} size={24} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-foreground">{nameFor(c.author_id)}</span>
                  <span className="text-xs text-muted-foreground">{formatRelativeTime(c.created_at)}</span>
                  {(c.author_id === currentUserId || isAdmin) && !c.id.startsWith("optimistic-") && (
                    <button
                      type="button"
                      aria-label="Delete comment"
                      onClick={() => remove(c.id)}
                      className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-600 focus-visible:opacity-100"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <p className="text-sm text-foreground whitespace-pre-wrap">{c.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-start gap-2 pt-1">
        <MemberAvatar userId={currentUserId} name="You" size={24} />
        <div className="flex-1 space-y-1.5">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Write a comment…"
            rows={2}
            disabled={sending}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={submit} disabled={!draft.trim() || sending}>
              Comment
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

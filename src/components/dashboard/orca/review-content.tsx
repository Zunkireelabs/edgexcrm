"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Bot, CheckCircle2, XCircle, Pencil, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { AgentReviewItem } from "@/lib/ai/agents/queries";
import { KIND_LABELS, formatAgentRelativeTime } from "@/lib/ai/agents/labels";

interface ReviewContentProps {
  items: AgentReviewItem[];
}

const EDITABLE_KINDS = new Set(["score_suggestion", "task_suggestion", "draft_email"]);

interface ScoreDraft {
  score: string;
  reasoning: string;
}

interface TaskDraft {
  title: string;
  description: string;
  dueDate: string;
}

interface EmailDraft {
  subject: string;
  body: string;
}

function PayloadPreview({ item }: { item: AgentReviewItem }) {
  if (item.kind === "score_suggestion") {
    const p = item.payload as { score?: number; reasoning?: string };
    return (
      <div className="space-y-1">
        <div className="text-2xl font-bold text-gray-900">
          {p.score ?? "—"}
          <span className="text-sm text-gray-400 font-normal"> / 100</span>
        </div>
        <p className="text-sm text-gray-600">{p.reasoning}</p>
      </div>
    );
  }
  if (item.kind === "task_suggestion") {
    const p = item.payload as { title?: string; description?: string | null; dueDate?: string | null };
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium text-gray-900">{p.title}</p>
        {p.description && <p className="text-sm text-gray-600">{p.description}</p>}
        {p.dueDate && <p className="text-xs text-gray-400">Due {p.dueDate}</p>}
      </div>
    );
  }
  if (item.kind === "draft_email") {
    const p = item.payload as { subject?: string; body?: string };
    return (
      <div className="space-y-1">
        <p className="text-sm font-semibold text-gray-900">{p.subject}</p>
        <p className="text-sm text-gray-600 whitespace-pre-wrap">{p.body}</p>
      </div>
    );
  }
  if (item.kind === "daily_digest") {
    const p = item.payload as { summary?: string; highlights?: string[] };
    return (
      <div className="space-y-2">
        <p className="text-sm text-gray-700 whitespace-pre-wrap">{p.summary}</p>
        {p.highlights && p.highlights.length > 0 && (
          <ul className="list-disc pl-5 space-y-0.5">
            {p.highlights.map((h, i) => (
              <li key={i} className="text-sm text-gray-600">{h}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  // lead_summary — no editor built for this yet, render raw payload
  return (
    <pre className="text-sm text-gray-600 whitespace-pre-wrap font-sans bg-gray-50 rounded-lg p-3">
      {JSON.stringify(item.payload, null, 2)}
    </pre>
  );
}

function Header({ count }: { count?: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="p-2 bg-[#eb1600] rounded-lg">
        <Inbox className="w-6 h-6 text-white" />
      </div>
      <div>
        <h1 className="text-lg font-bold">Review Queue</h1>
        <p className="text-sm text-muted-foreground">
          {count === undefined
            ? "Agent suggestions awaiting your decision"
            : `${count} suggestion${count === 1 ? "" : "s"} awaiting your decision`}
        </p>
      </div>
    </div>
  );
}

export function ReviewContent({ items: initialItems }: ReviewContentProps) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [scoreDraft, setScoreDraft] = useState<ScoreDraft>({ score: "", reasoning: "" });
  const [taskDraft, setTaskDraft] = useState<TaskDraft>({ title: "", description: "", dueDate: "" });
  const [emailDraft, setEmailDraft] = useState<EmailDraft>({ subject: "", body: "" });

  function openEdit(item: AgentReviewItem) {
    if (item.kind === "score_suggestion") {
      const p = item.payload as { score?: number; reasoning?: string };
      setScoreDraft({ score: String(p.score ?? 0), reasoning: p.reasoning ?? "" });
    } else if (item.kind === "task_suggestion") {
      const p = item.payload as { title?: string; description?: string | null; dueDate?: string | null };
      setTaskDraft({ title: p.title ?? "", description: p.description ?? "", dueDate: p.dueDate ?? "" });
    } else if (item.kind === "draft_email") {
      const p = item.payload as { subject?: string; body?: string };
      setEmailDraft({ subject: p.subject ?? "", body: p.body ?? "" });
    }
    setEditingId(item.id);
  }

  async function decide(item: AgentReviewItem, decision: "accept" | "dismiss", editedPayload?: Record<string, unknown>) {
    setPendingId(item.id);
    try {
      const res = await fetch(`/api/v1/agent-outputs/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editedPayload ? { decision, editedPayload } : { decision }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || "Failed to update suggestion");
      }
      toast.success(
        decision === "dismiss" ? "Suggestion dismissed" : editedPayload ? "Edited and accepted" : "Suggestion accepted",
      );
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setEditingId(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update suggestion");
    } finally {
      setPendingId(null);
    }
  }

  function saveEdit(item: AgentReviewItem) {
    if (item.kind === "score_suggestion") {
      const score = Number(scoreDraft.score);
      if (!Number.isInteger(score) || score < 0 || score > 100) {
        toast.error("Score must be a whole number between 0 and 100");
        return;
      }
      if (!scoreDraft.reasoning.trim()) {
        toast.error("Reasoning is required");
        return;
      }
      decide(item, "accept", { score, reasoning: scoreDraft.reasoning.trim() });
      return;
    }
    if (item.kind === "task_suggestion") {
      if (!taskDraft.title.trim()) {
        toast.error("Title is required");
        return;
      }
      decide(item, "accept", {
        title: taskDraft.title.trim(),
        ...(taskDraft.description.trim() ? { description: taskDraft.description.trim() } : {}),
        ...(taskDraft.dueDate.trim() ? { dueDate: taskDraft.dueDate.trim() } : {}),
      });
      return;
    }
    if (item.kind === "draft_email") {
      if (!emailDraft.subject.trim() || !emailDraft.body.trim()) {
        toast.error("Subject and body are required");
        return;
      }
      decide(item, "accept", { subject: emailDraft.subject.trim(), body: emailDraft.body.trim() });
    }
  }

  if (items.length === 0) {
    return (
      <div className="space-y-6">
        <Header />
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Inbox className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No suggestions waiting for review</h3>
          <p className="text-sm text-gray-500">Agent drafts will show up here once they&apos;re proposed.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Header count={items.length} />
      <div className="space-y-4">
        {items.map((item) => {
          const isPending = pendingId === item.id;
          const isEditing = editingId === item.id;
          return (
            <div key={item.id} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Bot className="w-4 h-4 text-gray-400" />
                    <span className="text-sm font-medium text-gray-900">{item.agentName}</span>
                    <span className="text-xs text-gray-400">·</span>
                    <span className="text-xs text-gray-500">{KIND_LABELS[item.kind] ?? item.kind}</span>
                  </div>
                  {item.subjectLabel && (
                    <div className="mt-1 text-sm">
                      {item.subjectId && item.subjectType === "lead" ? (
                        <Link href={`/leads/${item.subjectId}`} className="text-[#eb1600] hover:underline">
                          {item.subjectLabel}
                        </Link>
                      ) : (
                        <span className="text-gray-600">{item.subjectLabel}</span>
                      )}
                    </div>
                  )}
                </div>
                <span className="text-xs text-gray-400 whitespace-nowrap">{formatAgentRelativeTime(item.createdAt)}</span>
              </div>

              <div className="mb-4">
                {isEditing && item.kind === "score_suggestion" ? (
                  <div className="space-y-2">
                    <Label>Score (0-100)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={scoreDraft.score}
                      onChange={(e) => setScoreDraft((d) => ({ ...d, score: e.target.value }))}
                    />
                    <Label>Reasoning</Label>
                    <Textarea
                      value={scoreDraft.reasoning}
                      onChange={(e) => setScoreDraft((d) => ({ ...d, reasoning: e.target.value }))}
                    />
                  </div>
                ) : isEditing && item.kind === "task_suggestion" ? (
                  <div className="space-y-2">
                    <Label>Title</Label>
                    <Input
                      value={taskDraft.title}
                      onChange={(e) => setTaskDraft((d) => ({ ...d, title: e.target.value }))}
                    />
                    <Label>Description</Label>
                    <Textarea
                      value={taskDraft.description}
                      onChange={(e) => setTaskDraft((d) => ({ ...d, description: e.target.value }))}
                    />
                    <Label>Due date</Label>
                    <Input
                      type="date"
                      value={taskDraft.dueDate}
                      onChange={(e) => setTaskDraft((d) => ({ ...d, dueDate: e.target.value }))}
                    />
                  </div>
                ) : isEditing && item.kind === "draft_email" ? (
                  <div className="space-y-2">
                    <Label>Subject</Label>
                    <Input
                      value={emailDraft.subject}
                      onChange={(e) => setEmailDraft((d) => ({ ...d, subject: e.target.value }))}
                    />
                    <Label>Body</Label>
                    <Textarea
                      rows={8}
                      value={emailDraft.body}
                      onChange={(e) => setEmailDraft((d) => ({ ...d, body: e.target.value }))}
                    />
                  </div>
                ) : (
                  <PayloadPreview item={item} />
                )}
              </div>

              <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
                {isEditing ? (
                  <>
                    <Button size="sm" disabled={isPending} onClick={() => saveEdit(item)}>
                      {isPending ? "Saving…" : "Save & accept"}
                    </Button>
                    <Button size="sm" variant="outline" disabled={isPending} onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" disabled={isPending} onClick={() => decide(item, "accept")}>
                      <CheckCircle2 className="w-4 h-4" />
                      Accept
                    </Button>
                    {EDITABLE_KINDS.has(item.kind) && (
                      <Button size="sm" variant="outline" disabled={isPending} onClick={() => openEdit(item)}>
                        <Pencil className="w-4 h-4" />
                        Edit
                      </Button>
                    )}
                    <Button size="sm" variant="outline" disabled={isPending} onClick={() => decide(item, "dismiss")}>
                      <XCircle className="w-4 h-4" />
                      Dismiss
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

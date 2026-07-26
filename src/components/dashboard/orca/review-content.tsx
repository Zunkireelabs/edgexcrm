"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Bot, CheckCircle2, XCircle, Pencil, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { AgentReviewItem, AgentApprovalItem } from "@/lib/ai/agents/queries";
import { KIND_LABELS, formatAgentRelativeTime } from "@/lib/ai/agents/labels";
import {
  describeApprovalRows,
  collectApprovalRefs,
  resolveRowDisplay,
  refKey,
  type EntityRef,
  type ResolvedRef,
} from "@/lib/ai/tools/universal/lib/approval-resolve";
import { ApprovalsSection } from "@/components/dashboard/orca/approvals-section";

interface ReviewContentProps {
  items: AgentReviewItem[];
  approvals: AgentApprovalItem[];
}

const EDITABLE_KINDS = new Set(["score_suggestion", "task_suggestion", "draft_email"]);

/**
 * 5.4d Defect A fix: a write_action_proposal that reaches this queue is
 * always the "human_led" tier (agent_human-tier ones are excluded server-side
 * by getReviewQueue — they surface in the Approvals section instead, with a
 * real accept path). This tier's "Accept" button previously flipped
 * agent_outputs.status without executing anything or touching
 * agent_approvals — a misleading consent surface. There's nothing to accept
 * here; this is an FYI that the agent tried something it isn't authorized
 * for.
 */
function isUnauthorizedWriteProposal(item: AgentReviewItem): boolean {
  return item.kind === "write_action_proposal";
}

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

function PayloadPreview({ item, resolved }: { item: AgentReviewItem; resolved: Record<string, ResolvedRef> }) {
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
  if (isUnauthorizedWriteProposal(item)) {
    // Reused describer + resolver, same as the real Approvals section, incl.
    // real ref resolution (ReviewContent below fetches it) — never render a
    // raw id from tool_input as if it were a label, same invariant as the
    // Approvals section, even though nothing executes on this item.
    const p = item.payload as { tool_id?: string; input?: unknown };
    const rows = describeApprovalRows(p.tool_id ?? "", p.input);
    return (
      <div className="space-y-2">
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
          This agent isn&apos;t authorized to perform this action — it&apos;s shown for your awareness.
        </p>
        {rows.length > 0 && (
          <dl className="space-y-1">
            {rows.map((row, i) => {
              const display = resolveRowDisplay(row, resolved);
              return (
                <div key={i} className="flex gap-2 text-sm">
                  <dt className="text-gray-500 shrink-0">{row.label}:</dt>
                  <dd className={`break-words ${display.tone === "notFound" ? "text-red-700 font-medium" : "text-gray-900"}`}>
                    {display.text}
                  </dd>
                </div>
              );
            })}
          </dl>
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

function PageHeader() {
  return (
    <div className="flex items-center gap-3">
      <div className="p-2 bg-[#eb1600] rounded-lg">
        <Inbox className="w-6 h-6 text-white" />
      </div>
      <div>
        <h1 className="text-lg font-bold">Review Queue</h1>
        <p className="text-sm text-muted-foreground">Everything waiting on a human decision</p>
      </div>
    </div>
  );
}

function SuggestionsHeader({ count }: { count: number }) {
  return (
    <div>
      <h2 className="text-base font-bold text-gray-900">Suggestions</h2>
      <p className="text-xs text-gray-500">
        Drafts for you to act on — {count} suggestion{count === 1 ? "" : "s"} awaiting your decision.
      </p>
    </div>
  );
}

export function ReviewContent({ items: initialItems, approvals }: ReviewContentProps) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [scoreDraft, setScoreDraft] = useState<ScoreDraft>({ score: "", reasoning: "" });
  const [taskDraft, setTaskDraft] = useState<TaskDraft>({ title: "", description: "", dueDate: "" });
  const [emailDraft, setEmailDraft] = useState<EmailDraft>({ subject: "", body: "" });
  const [resolved, setResolved] = useState<Record<string, ResolvedRef>>({});

  // Ref resolution for the "unauthorized write proposal" rows only (Defect A
  // fix) — the score/task/email/digest kinds never carry an EntityRef, so
  // this is a no-op for them.
  useEffect(() => {
    const unique = new Map<string, EntityRef>();
    for (const item of items) {
      if (!isUnauthorizedWriteProposal(item)) continue;
      const p = item.payload as { tool_id?: string; input?: unknown };
      const rows = describeApprovalRows(p.tool_id ?? "", p.input);
      for (const ref of collectApprovalRefs(rows)) unique.set(refKey(ref), ref);
    }
    const refs = [...unique.values()];
    if (refs.length === 0) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/ai/resolve-approval-refs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refs }),
        });
        if (!res.ok || cancelled) return;
        const body = await res.json();
        if (!cancelled) setResolved((prev) => ({ ...prev, ...body.data.resolved }));
      } catch {
        // Non-fatal — rows stay in the "Resolving…" state rather than fabricating a label.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [items]);

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

  return (
    <div className="space-y-6">
      <PageHeader />

      <ApprovalsSection items={approvals} />

      <div className="space-y-4">
        <SuggestionsHeader count={items.length} />

        {items.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <Inbox className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No suggestions waiting for review</h3>
            <p className="text-sm text-gray-500">Agent drafts will show up here once they&apos;re proposed.</p>
          </div>
        ) : (
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
                  <PayloadPreview item={item} resolved={resolved} />
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
                      {/* Defect A fix: this tier executes nothing on "accept" — never call it "Accept". decision:"accept" on the wire is unchanged (existing status vocabulary). */}
                      {isUnauthorizedWriteProposal(item) ? "Mark handled" : "Accept"}
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
        )}
      </div>
    </div>
  );
}

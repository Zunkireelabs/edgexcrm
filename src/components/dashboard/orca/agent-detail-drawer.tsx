"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import type { AgentDetail, AgentDetailWrite } from "@/lib/ai/agents/queries";
import { KIND_LABELS, formatAgentRelativeTime } from "@/lib/ai/agents/labels";
import {
  describeApprovalRows,
  collectApprovalRefs,
  resolveRowDisplay,
  refKey,
  type EntityRef,
  type ResolvedRef,
} from "@/lib/ai/tools/universal/lib/approval-resolve";
import { UNDOABLE_TOOL_IDS } from "@/lib/ai/tools/universal/lib/lead-patch-result";

interface AgentDetailDrawerProps {
  agentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Imperative framing, same wording precedent as approval-card.tsx's
// APPROVAL_ACTION_LABELS — kept as its own small local map since this
// surface (past tense: "what happened") renders independently of the
// approval surfaces (present tense: "what will happen").
const WRITE_ACTION_PAST_TENSE_LABELS: Record<string, string> = {
  create_task: "Created a task",
  update_lead_stage: "Moved a lead to another stage",
  assign_lead: "Assigned a lead",
};

function writeActionLabel(toolId: string): string {
  return WRITE_ACTION_PAST_TENSE_LABELS[toolId] ?? `Ran "${toolId}"`;
}

const RUN_STATUS_LABELS: Record<string, string> = {
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  // 5.4d: a run whose write proposals are still awaiting a human decision —
  // see mig 190 + approval-gate.ts's mark-awaiting-approval/mark-approvals-
  // settled steps.
  awaiting_approval: "Awaiting approval",
};

const OUTPUT_STATUS_LABELS: Record<string, string> = {
  proposed: "Awaiting review",
  accepted: "Accepted",
  edited_accepted: "Edited & accepted",
  dismissed: "Dismissed",
  expired: "Expired",
};

const RUN_STATUS_TEXT: Record<string, string> = {
  failed: "text-red-600",
  completed: "text-emerald-600",
  awaiting_approval: "text-amber-600",
};

/**
 * Read-only "what will it do / what has it done" panel for one hired agent —
 * fetches GET /api/v1/agent-identities/[id] (admin-only, tenant-scoped) on open.
 */
export function AgentDetailDrawer({ agentId, open, onOpenChange }: AgentDetailDrawerProps) {
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<Record<string, ResolvedRef>>({});
  const [undoingId, setUndoingId] = useState<string | null>(null);

  const fetchDetail = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    setDetail(null);
    try {
      const res = await fetch(`/api/v1/agent-identities/${id}`);
      if (!res.ok) throw new Error("Failed to load agent detail");
      const body = await res.json();
      setDetail(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agent detail");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !agentId) return;
    fetchDetail(agentId);
  }, [open, agentId, fetchDetail]);

  // Ref resolution for the "Actions taken" rows — same invariant as every
  // other approval/write surface in this slice: never render a raw id from
  // tool input as if it were a label.
  useEffect(() => {
    if (!detail || detail.recentWrites.length === 0) return;
    const unique = new Map<string, EntityRef>();
    for (const write of detail.recentWrites) {
      const rows = describeApprovalRows(write.toolId, write.input);
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
  }, [detail]);

  async function undoWrite(write: AgentDetailWrite) {
    setUndoingId(write.id);
    try {
      const res = await fetch(`/api/v1/agent-writes/${write.id}/undo`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error?.details?.undo?.[0] || body.error?.message || "Failed to undo this action");
      }
      toast.success("Action undone");
      setDetail((d) => (d ? { ...d, recentWrites: d.recentWrites.map((w) => (w.id === write.id ? { ...w, undone: true } : w)) } : d));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to undo this action");
    } finally {
      setUndoingId(null);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Bot className="w-4 h-4" />
            {detail?.displayName ?? "Agent"}
          </SheetTitle>
          <SheetDescription>
            {detail ? (detail.positionName ? `Assigned to ${detail.positionName}` : "Unassigned") : " "}
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-6 space-y-6">
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}

          {detail && (
            <>
              {detail.capabilities && (
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase text-gray-500">Capabilities</h3>
                  <p className="text-sm text-gray-700">{detail.capabilities.trigger}</p>
                  {detail.capabilities.reads.length > 0 && (
                    <p className="text-sm text-gray-600">
                      <span className="font-medium text-gray-700">Reads:</span> {detail.capabilities.reads.join(", ")}
                    </p>
                  )}
                  {detail.capabilities.drafts.length > 0 && (
                    <p className="text-sm text-gray-600">
                      <span className="font-medium text-gray-700">Drafts:</span>{" "}
                      {detail.capabilities.drafts.join(", ")}
                    </p>
                  )}
                  {detail.capabilities.produces.length > 0 && (
                    <p className="text-sm text-gray-600">
                      <span className="font-medium text-gray-700">Produces:</span>{" "}
                      {detail.capabilities.produces.join(", ")}
                    </p>
                  )}
                  <p className="text-xs italic text-gray-500">{detail.capabilities.guarantee}</p>
                </section>
              )}

              <section className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-gray-200 p-3">
                  <p className="text-xs text-gray-500">Tasks</p>
                  <p className="text-lg font-semibold text-gray-900">{detail.stats.tasksCompleted}</p>
                </div>
                <div className="rounded-lg border border-gray-200 p-3">
                  <p className="text-xs text-gray-500">Acceptance</p>
                  <p className="text-lg font-semibold text-gray-900">
                    {detail.stats.successRate === null ? "—" : `${detail.stats.successRate}%`}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-200 p-3">
                  <p className="text-xs text-gray-500">Last active</p>
                  <p className="text-sm font-medium text-gray-900">{formatAgentRelativeTime(detail.stats.lastActive)}</p>
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase text-gray-500">What it&apos;s done</h3>
                {detail.recentRuns.length === 0 ? (
                  <p className="text-sm text-gray-500">No runs yet</p>
                ) : (
                  <ul className="space-y-2">
                    {detail.recentRuns.map((run) => (
                      <li key={run.id} className="rounded-lg border border-gray-200 p-3 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-gray-900">{run.triggerEvent}</span>
                          <span className="text-xs text-gray-400 whitespace-nowrap">
                            {formatAgentRelativeTime(run.startedAt)}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                          {run.subjectLabel && <span>{run.subjectLabel}</span>}
                          <span className={RUN_STATUS_TEXT[run.status] ?? "text-gray-500"}>
                            {RUN_STATUS_LABELS[run.status] ?? run.status}
                          </span>
                          {run.durationMs !== null && <span>{run.durationMs}ms</span>}
                        </div>
                        {run.error && <p className="mt-1 text-xs text-red-600">{run.error}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase text-gray-500">Drafts produced</h3>
                {detail.recentOutputs.length === 0 ? (
                  <p className="text-sm text-gray-500">No outputs yet</p>
                ) : (
                  <ul className="space-y-2">
                    {detail.recentOutputs.map((output) => (
                      <li
                        key={output.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 p-3 text-sm"
                      >
                        <span className="text-gray-900">{KIND_LABELS[output.kind] ?? output.kind}</span>
                        <span className="text-xs text-gray-500 whitespace-nowrap">
                          {OUTPUT_STATUS_LABELS[output.status] ?? output.status}
                        </span>
                        <span className="text-xs text-gray-400 whitespace-nowrap">
                          {formatAgentRelativeTime(output.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase text-gray-500">Actions taken</h3>
                {detail.recentWrites.length === 0 ? (
                  <p className="text-sm text-gray-500">No executed actions yet</p>
                ) : (
                  <ul className="space-y-2">
                    {detail.recentWrites.map((write) => {
                      const rows = describeApprovalRows(write.toolId, write.input);
                      const canUndo = UNDOABLE_TOOL_IDS.includes(write.toolId);
                      return (
                        <li key={write.id} className="rounded-lg border border-gray-200 p-3 text-sm">
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-medium text-gray-900">{writeActionLabel(write.toolId)}</span>
                            <span className="text-xs text-gray-400 whitespace-nowrap">{formatAgentRelativeTime(write.createdAt)}</span>
                          </div>

                          {rows.length > 0 && (
                            <dl className="mt-1 flex flex-col gap-0.5">
                              {rows.map((row, i) => {
                                const display = resolveRowDisplay(row, resolved);
                                return (
                                  <div key={i} className="flex gap-1.5 text-xs">
                                    <dt className="text-gray-500 shrink-0">{row.label}:</dt>
                                    <dd className={display.tone === "notFound" ? "text-red-700 font-medium break-words" : "text-gray-600 break-words"}>
                                      {display.text}
                                    </dd>
                                  </div>
                                );
                              })}
                            </dl>
                          )}

                          <div className="mt-2 flex items-center justify-between gap-2">
                            <span className="text-xs text-gray-400">
                              Agent action{write.approvedBy ? ` · approved by ${write.approvedBy}` : ""}
                            </span>
                            {canUndo &&
                              (write.undone ? (
                                <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                                  Undone
                                </span>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={undoingId === write.id}
                                  onClick={() => undoWrite(write)}
                                >
                                  <Undo2 className="w-3.5 h-3.5" />
                                  {undoingId === write.id ? "Undoing…" : "Undo"}
                                </Button>
                              ))}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

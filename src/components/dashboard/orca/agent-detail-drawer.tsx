"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import type { AgentDetail } from "@/lib/ai/agents/queries";
import { KIND_LABELS, formatAgentRelativeTime } from "@/lib/ai/agents/labels";

interface AgentDetailDrawerProps {
  agentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const RUN_STATUS_LABELS: Record<string, string> = {
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
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
};

/**
 * Read-only "what will it do / what has it done" panel for one hired agent —
 * fetches GET /api/v1/agent-identities/[id] (admin-only, tenant-scoped) on open.
 */
export function AgentDetailDrawer({ agentId, open, onOpenChange }: AgentDetailDrawerProps) {
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

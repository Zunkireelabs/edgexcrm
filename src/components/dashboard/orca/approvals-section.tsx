"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Bot, CheckCircle2, XCircle, ShieldAlert, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AgentApprovalItem } from "@/lib/ai/agents/queries";
import { formatAgentRelativeTime } from "@/lib/ai/agents/labels";
import {
  describeApprovalRows,
  collectApprovalRefs,
  resolveRowDisplay,
  refKey,
  type EntityRef,
  type ResolvedRef,
} from "@/lib/ai/tools/universal/lib/approval-resolve";

interface ApprovalsSectionProps {
  items: AgentApprovalItem[];
}

/** Imperative action framing — mirrors approval-card.tsx's APPROVAL_ACTION_LABELS (the chat-side precedent for this exact wording), kept as its own small map rather than imported since the two surfaces render independently. */
const APPROVAL_ACTION_LABELS: Record<string, string> = {
  create_task: "Create a task",
  update_lead_stage: "Move a lead to another stage",
  assign_lead: "Assign a lead",
};

function approvalActionLabel(toolId: string): string {
  return APPROVAL_ACTION_LABELS[toolId] ?? `Run "${toolId}"`;
}

/** "Expires in ~N hours" — the 48h window (agent_approvals.expires_at, mig 187) is real and an approver needs to see it before it lapses. */
function expiryHint(expiresAt: string): string {
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  if (diffMs <= 0) return "Expiring imminently";
  const diffHours = diffMs / (1000 * 60 * 60);
  if (diffHours < 1) return "Expires in <1 hour";
  const hours = Math.round(diffHours);
  return `Expires in ~${hours} hour${hours === 1 ? "" : "s"}`;
}

function ApprovalCard({
  item,
  resolved,
  pending,
  onDecide,
}: {
  item: AgentApprovalItem;
  resolved: Record<string, ResolvedRef>;
  pending: boolean;
  onDecide: (decision: "approve" | "reject") => void;
}) {
  const rows = describeApprovalRows(item.toolId, item.toolInput);

  return (
    <div className="bg-white rounded-xl border border-amber-200 p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-gray-400" />
            <span className="text-sm font-medium text-gray-900">{item.agentName}</span>
          </div>
          <p className="mt-1 text-sm font-semibold text-gray-900">{approvalActionLabel(item.toolId)}</p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs text-gray-400 whitespace-nowrap">{formatAgentRelativeTime(item.requestedAt)}</div>
          <div className="text-xs text-amber-600 whitespace-nowrap">{expiryHint(item.expiresAt)}</div>
        </div>
      </div>

      {rows.length > 0 && (
        <dl className="mb-4 flex flex-col gap-1.5">
          {rows.map((row, i) => {
            // Never render an id from tool_input as if it were a label — a
            // NOT-FOUND ref must stay visible and styled destructively (a
            // safety feature, not an error state: approval-resolve.ts's
            // docstring + BRIEF-PHASE-4D-FIXUP finding 1).
            const display = resolveRowDisplay(row, resolved);
            const toneText =
              display.tone === "notFound"
                ? "text-red-700 font-medium"
                : display.tone === "loading"
                  ? "text-gray-400 italic"
                  : "text-gray-900";
            const toneBox = display.tone === "notFound" ? "border-red-300 bg-red-50" : "";

            return row.long ? (
              <div key={i} className="flex flex-col gap-0.5 text-sm">
                <dt className="text-gray-500">{row.label}:</dt>
                <dd className={cn("whitespace-pre-wrap break-words max-h-40 overflow-y-auto rounded px-2 py-1.5", toneText, toneBox)}>
                  {display.text}
                </dd>
              </div>
            ) : (
              <div key={i} className="flex gap-2 text-sm">
                <dt className="text-gray-500 shrink-0">{row.label}:</dt>
                <dd className={cn("break-words", toneText, display.tone === "notFound" ? cn("rounded px-1.5 py-0.5", toneBox) : "")}>
                  {display.text}
                </dd>
              </div>
            );
          })}
        </dl>
      )}

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-3 border-t border-gray-100">
        <Button size="sm" className="w-full sm:w-auto" disabled={pending} onClick={() => onDecide("approve")}>
          <CheckCircle2 className="w-4 h-4" />
          Approve
        </Button>
        <Button size="sm" variant="outline" className="w-full sm:w-auto" disabled={pending} onClick={() => onDecide("reject")}>
          <XCircle className="w-4 h-4" />
          Reject
        </Button>
      </div>
    </div>
  );
}

/**
 * The consent surface for agent_human write proposals (5.4d Part 3) — the
 * one place a pending agent_approvals row is visible and decidable anywhere
 * in the app. Renders above the existing suggestions list on /orca/review.
 * Every id-bearing field is resolved server-side via resolve-approval-refs,
 * never rendered from the stored `agent_approvals.preview` column (a stub
 * with no viewer-scoped visibility check — see buildApprovalPreview's
 * docstring in approval-flow.ts) and never from raw tool_input.
 */
export function ApprovalsSection({ items: initialItems }: ApprovalsSectionProps) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [resolved, setResolved] = useState<Record<string, ResolvedRef>>({});

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  useEffect(() => {
    if (items.length === 0) return;

    const unique = new Map<string, EntityRef>();
    for (const item of items) {
      const rows = describeApprovalRows(item.toolId, item.toolInput);
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
    // items' identity changes whenever the queue itself changes (initial load,
    // a decided row filtered out) — that's the only time refs need re-resolving.
  }, [items]);

  async function decide(item: AgentApprovalItem, decision: "approve" | "reject") {
    setPendingId(item.id);
    try {
      const res = await fetch(`/api/v1/agent-approvals/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || "Failed to update approval");
      }
      toast.success(decision === "approve" ? "Approved" : "Rejected");
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update approval");
    } finally {
      setPendingId(null);
    }
  }

  if (items.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-500 rounded-lg">
            <ShieldAlert className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-900">Actions awaiting your approval</h2>
            <p className="text-xs text-gray-500">These will change your CRM.</p>
          </div>
        </div>
        {/* Undo lives in the per-agent drawer this slice (5.4d accepted tradeoff) — this is the one pointer to it from here. */}
        <Link
          href="/orca/agents"
          className="inline-flex items-center gap-1 text-xs text-[#eb1600] hover:underline whitespace-nowrap"
        >
          See actions already taken
          <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
      <div className="space-y-3">
        {items.map((item) => (
          <ApprovalCard
            key={item.id}
            item={item}
            resolved={resolved}
            pending={pendingId === item.id}
            onDecide={(decision) => decide(item, decision)}
          />
        ))}
      </div>
    </section>
  );
}

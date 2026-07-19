"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { getToolName, type ToolUIPart, type DynamicToolUIPart, type UITools } from "ai";
import { Button } from "@/components/ui/button";
import {
  describeApprovalRows,
  collectApprovalRefs,
  resolveRowDisplay,
  refKey,
  type PreviewRow,
  type ResolvedRef,
} from "@/lib/ai/tools/universal/lib/approval-resolve";

type ApprovalRequestedPart = (ToolUIPart<UITools> | DynamicToolUIPart) & { state: "approval-requested" };
type ApprovalRespondedPart = (ToolUIPart<UITools> | DynamicToolUIPart) & { state: "approval-responded" };
export type ApprovalToolPart = ApprovalRequestedPart | ApprovalRespondedPart;

/** Imperative, proposal-framed labels ("Create a task") — distinct from tool-labels.ts's present-continuous activity labels ("Creating task") used once a decision is running/done. */
const APPROVAL_ACTION_LABELS: Record<string, string> = {
  create_task: "Create a task",
  update_lead_stage: "Move a lead to another stage",
  assign_lead: "Assign a lead",
  undo_lead_action: "Undo a lead action",
  create_lead_note: "Add a note to a lead",
  create_knowledge_item: "Save a note to a knowledge base",
};

function approvalActionLabel(toolName: string): string {
  return APPROVAL_ACTION_LABELS[toolName] ?? `Run "${toolName}"`;
}

/**
 * Resolves every id-bearing row (see approval-resolve.ts's `PreviewRow.ref`)
 * to a display label via the tenant-scoped resolve-approval-refs endpoint.
 * Never resolved from model output — see BRIEF-PHASE-4D-APPROVAL-CARD-IDENTITY.md.
 */
function useResolvedRefs(rows: PreviewRow[]): Record<string, ResolvedRef> {
  const refs = collectApprovalRefs(rows);
  const dedupeKey = refs.map(refKey).sort().join(",");
  const [resolved, setResolved] = useState<Record<string, ResolvedRef>>({});

  useEffect(() => {
    if (refs.length === 0) return;
    let cancelled = false;

    fetch("/api/v1/ai/resolve-approval-refs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refs }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled || !body?.data?.resolved) return;
        setResolved(body.data.resolved);
      })
      .catch(() => {
        // Leave rows in the "loading" state rather than fabricating a resolved label.
      });

    return () => {
      cancelled = true;
    };
    // dedupeKey is the actual dependency (stable across re-renders with the same
    // refs); refs itself is a fresh array every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dedupeKey]);

  return resolved;
}

interface ApprovalCardProps {
  part: ApprovalToolPart;
  onApprove: (approvalId: string) => void;
  onDeny: (approvalId: string) => void;
}

/**
 * Rendered by chat-message.tsx while a write tool's SDK-native approval flow
 * is pending or just decided. Accepted 4A limitation: this state does not
 * survive a page reload — conversation-history.ts reconstructs assistant
 * rows as text-only, so an undecided proposal simply lapses; the user just
 * asks again (no persistence work in this slice, see BRIEF-PHASE-4A §5).
 */
export function ApprovalCard({ part, onApprove, onDeny }: ApprovalCardProps) {
  const toolName = getToolName(part);
  const rows = describeApprovalRows(toolName, part.input);
  const resolved = useResolvedRefs(rows);
  const approvalId = part.approval.id;
  const decided = part.state === "approval-responded";
  const approved = decided ? part.approval.approved : undefined;

  return (
    <div className="max-w-[80%] rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex flex-col gap-2">
      <div className="text-xs font-semibold text-amber-900">{approvalActionLabel(toolName)} — approval needed</div>

      {rows.length > 0 && (
        <dl className="flex flex-col gap-1">
          {rows.map((row) => {
            const display = resolveRowDisplay(row, resolved);
            const toneText =
              display.tone === "notFound" ? "text-red-700 font-medium" : display.tone === "loading" ? "text-amber-600 italic" : "text-amber-900";
            const toneBox = display.tone === "notFound" ? "border-red-300 bg-red-50" : "border-amber-200 bg-amber-100/50";

            return row.long ? (
              <div key={row.label} className="flex flex-col gap-0.5 text-xs">
                <dt className="text-amber-700">{row.label}:</dt>
                <dd className={`whitespace-pre-wrap break-words max-h-40 overflow-y-auto rounded border px-2 py-1.5 ${toneText} ${toneBox}`}>
                  {display.text}
                </dd>
              </div>
            ) : (
              <div key={row.label} className="flex gap-2 text-xs">
                <dt className="text-amber-700 shrink-0">{row.label}:</dt>
                <dd className={`break-words ${toneText} ${display.tone === "notFound" ? `rounded border px-1.5 py-0.5 ${toneBox}` : ""}`}>
                  {display.text}
                </dd>
              </div>
            );
          })}
        </dl>
      )}

      {!decided ? (
        <div className="flex gap-2 pt-1">
          <Button size="sm" onClick={() => onApprove(approvalId)}>
            Approve
          </Button>
          <Button size="sm" variant="outline" onClick={() => onDeny(approvalId)}>
            Deny
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-xs text-amber-700 pt-1">
          {approved ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Approved — running…</span>
            </>
          ) : (
            <span>Denied</span>
          )}
        </div>
      )}
    </div>
  );
}

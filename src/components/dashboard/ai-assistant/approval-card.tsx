"use client";

import { Loader2 } from "lucide-react";
import { getToolName, type ToolUIPart, type DynamicToolUIPart, type UITools } from "ai";
import { Button } from "@/components/ui/button";

type ApprovalRequestedPart = (ToolUIPart<UITools> | DynamicToolUIPart) & { state: "approval-requested" };
type ApprovalRespondedPart = (ToolUIPart<UITools> | DynamicToolUIPart) & { state: "approval-responded" };
export type ApprovalToolPart = ApprovalRequestedPart | ApprovalRespondedPart;

interface PreviewRow {
  label: string;
  value: string;
}

function describeCreateTaskInput(input: unknown): PreviewRow[] {
  const i = (input ?? {}) as Record<string, unknown>;
  const rows: PreviewRow[] = [];
  if (typeof i.title === "string" && i.title) rows.push({ label: "Title", value: i.title });
  rows.push({ label: "Priority", value: typeof i.priority === "string" && i.priority ? i.priority : "normal" });
  rows.push({ label: "Due date", value: typeof i.dueDate === "string" && i.dueDate ? i.dueDate : "None" });
  rows.push({ label: "Assignee", value: typeof i.assigneeId === "string" && i.assigneeId ? i.assigneeId : "You" });
  if (typeof i.leadId === "string" && i.leadId) rows.push({ label: "Lead", value: i.leadId });
  if (typeof i.description === "string" && i.description) rows.push({ label: "Description", value: i.description });
  return rows;
}

function describeUpdateLeadStageInput(input: unknown): PreviewRow[] {
  const i = (input ?? {}) as Record<string, unknown>;
  const rows: PreviewRow[] = [];
  if (typeof i.leadId === "string" && i.leadId) rows.push({ label: "Lead", value: i.leadId });
  const stage = (typeof i.stageName === "string" && i.stageName) || (typeof i.stageId === "string" && i.stageId) || "";
  rows.push({ label: "Stage", value: stage || "—" });
  return rows;
}

function describeAssignLeadInput(input: unknown): PreviewRow[] {
  const i = (input ?? {}) as Record<string, unknown>;
  const rows: PreviewRow[] = [];
  if (typeof i.leadId === "string" && i.leadId) rows.push({ label: "Lead", value: i.leadId });
  rows.push({ label: "Assignee", value: typeof i.assigneeId === "string" && i.assigneeId ? i.assigneeId : "—" });
  return rows;
}

function describeUndoLeadActionInput(input: unknown): PreviewRow[] {
  const i = (input ?? {}) as Record<string, unknown>;
  return [{ label: "Action", value: typeof i.actionId === "string" && i.actionId ? i.actionId : "most recent" }];
}

/** Per-tool preview renderers. Falls back to a generic key/value dump for any write tool without one. */
const INPUT_DESCRIBERS: Record<string, (input: unknown) => PreviewRow[]> = {
  create_task: describeCreateTaskInput,
  update_lead_stage: describeUpdateLeadStageInput,
  assign_lead: describeAssignLeadInput,
  undo_lead_action: describeUndoLeadActionInput,
};

function describeInput(toolName: string, input: unknown): PreviewRow[] {
  const describer = INPUT_DESCRIBERS[toolName];
  if (describer) return describer(input);
  if (!input || typeof input !== "object") return [];
  return Object.entries(input as Record<string, unknown>).map(([label, value]) => ({
    label,
    value: value === undefined || value === null ? "—" : String(value),
  }));
}

/** Imperative, proposal-framed labels ("Create a task") — distinct from tool-labels.ts's present-continuous activity labels ("Creating task") used once a decision is running/done. */
const APPROVAL_ACTION_LABELS: Record<string, string> = {
  create_task: "Create a task",
  update_lead_stage: "Move a lead to another stage",
  assign_lead: "Assign a lead",
  undo_lead_action: "Undo a lead action",
};

function approvalActionLabel(toolName: string): string {
  return APPROVAL_ACTION_LABELS[toolName] ?? `Run "${toolName}"`;
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
  const rows = describeInput(toolName, part.input);
  const approvalId = part.approval.id;
  const decided = part.state === "approval-responded";
  const approved = decided ? part.approval.approved : undefined;

  return (
    <div className="max-w-[80%] rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex flex-col gap-2">
      <div className="text-xs font-semibold text-amber-900">{approvalActionLabel(toolName)} — approval needed</div>

      {rows.length > 0 && (
        <dl className="flex flex-col gap-0.5">
          {rows.map((row) => (
            <div key={row.label} className="flex gap-2 text-xs">
              <dt className="text-amber-700 shrink-0">{row.label}:</dt>
              <dd className="text-amber-900 break-words">{row.value}</dd>
            </div>
          ))}
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

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  CheckSquare,
  Loader2,
  ThumbsUp,
  ThumbsDown,
  ArrowRight,
  Clock,
  Flag,
  FileEdit,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMoney } from "@/lib/travel/currency";

interface ApprovalRow {
  kind: "time_entry" | "milestone" | "change_request";
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  submittedAt: string;
  submittedByName?: string | null;
  detail: Record<string, unknown>;
}

interface ApprovalsData {
  timeEntries: ApprovalRow[];
  milestones: ApprovalRow[];
  changeRequests: ApprovalRow[];
  counts: { timeEntries: number; milestones: number; changeRequests: number; total: number };
}

interface ApprovalsInboxPageProps {
  role: string;
}

const APPROVE_PATH: Record<ApprovalRow["kind"], (id: string) => string> = {
  time_entry: (id) => `/api/v1/time-entries/${id}/approve`,
  milestone: (id) => `/api/v1/milestones/${id}/accept`,
  change_request: (id) => `/api/v1/change-requests/${id}/approve`,
};

const REJECT_PATH: Record<ApprovalRow["kind"], (id: string) => string> = {
  time_entry: (id) => `/api/v1/time-entries/${id}/reject`,
  milestone: (id) => `/api/v1/milestones/${id}/reject`,
  change_request: (id) => `/api/v1/change-requests/${id}/reject`,
};

const KIND_LABEL: Record<ApprovalRow["kind"], string> = {
  time_entry: "time entry",
  milestone: "milestone",
  change_request: "change request",
};

function waitingAge(iso: string): string {
  const then = new Date(iso).getTime();
  const days = Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

async function postAction(url: string, reason?: string): Promise<{ ok: true } | { ok: false; conflict: boolean; message: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: reason !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: reason !== undefined ? JSON.stringify({ reason }) : undefined,
  });
  if (res.ok) return { ok: true };
  const { error: apiErr } = await res.json().catch(() => ({}));
  return { ok: false, conflict: res.status === 409, message: apiErr?.message ?? "Request failed" };
}

// ── Change request / milestone row ──────────────────────────────────

interface ActionRowProps {
  row: ApprovalRow;
  processing: boolean;
  onApprove: (row: ApprovalRow) => void;
  onRejectClick: (row: ApprovalRow) => void;
}

function ChangeRequestRow({ row, processing, onApprove, onRejectClick }: ActionRowProps) {
  const classification = String(row.detail.classification ?? "");
  const deltaMinutes = Number(row.detail.estimateDeltaMinutes ?? 0);
  const deltaHours = Math.round(deltaMinutes / 60);
  const budgetDelta = row.detail.budgetDeltaAmount as number | null;
  const currency = String(row.detail.currency ?? "NPR");

  return (
    <div className="flex items-center gap-3 py-3 px-4 hover:bg-muted/40 rounded-lg">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{row.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {row.projectName} · waiting {waitingAge(row.submittedAt)}
        </p>
      </div>
      <div className="shrink-0 flex items-center gap-2">
        <Badge variant={classification === "new_scope" ? "default" : "secondary"} className="text-[10px]">
          {classification === "new_scope" ? "New scope" : "In scope"}
        </Badge>
        <span className="text-xs font-medium tabular-nums text-muted-foreground">
          {deltaMinutes >= 0 ? "+" : ""}
          {deltaHours}h
        </span>
        {budgetDelta != null && (
          <span className="text-xs font-medium tabular-nums text-muted-foreground">
            {budgetDelta >= 0 ? "+" : ""}
            {formatMoney(budgetDelta, currency)}
          </span>
        )}
      </div>
      <RowActions row={row} processing={processing} onApprove={onApprove} onRejectClick={onRejectClick} />
    </div>
  );
}

function MilestoneRow({ row, processing, onApprove, onRejectClick }: ActionRowProps) {
  const amount = row.detail.amount as number | null;
  const dueDate = row.detail.dueDate as string | null;
  const currency = String(row.detail.currency ?? "NPR");

  return (
    <div className="flex items-center gap-3 py-3 px-4 hover:bg-muted/40 rounded-lg">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{row.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {row.projectName} · submitted {waitingAge(row.submittedAt)}
          {dueDate && ` · due ${new Date(dueDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
        </p>
      </div>
      {amount != null && (
        <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
          {formatMoney(amount, currency)}
        </span>
      )}
      <RowActions row={row} processing={processing} onApprove={onApprove} onRejectClick={onRejectClick} />
    </div>
  );
}

function RowActions({ row, processing, onApprove, onRejectClick }: ActionRowProps) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={() => onApprove(row)}
        disabled={processing}
        title="Approve"
      >
        {processing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ThumbsUp className="h-3.5 w-3.5 text-emerald-600" />}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={() => onRejectClick(row)}
        disabled={processing}
        title="Reject"
      >
        <ThumbsDown className="h-3.5 w-3.5 text-red-600" />
      </Button>
    </div>
  );
}

// ── Time entries: grouped by member ─────────────────────────────────

interface MemberGroup {
  userId: string;
  label: string;
  rows: ApprovalRow[];
  totalMinutes: number;
}

function groupTimeEntriesByMember(rows: ApprovalRow[]): MemberGroup[] {
  const map = new Map<string, ApprovalRow[]>();
  for (const row of rows) {
    const userId = String(row.detail.userId ?? "unknown");
    const g = map.get(userId) ?? [];
    g.push(row);
    map.set(userId, g);
  }
  return Array.from(map.entries()).map(([userId, grp]) => ({
    userId,
    label: grp[0]?.submittedByName || `${userId.slice(0, 8)}…`,
    rows: grp,
    totalMinutes: grp.reduce((sum, r) => sum + Number(r.detail.minutes ?? 0), 0),
  }));
}

function formatHours(minutes: number): string {
  return (minutes / 60).toFixed(1) + "h";
}

// ── Main page ────────────────────────────────────────────────────────

export function ApprovalsInboxPage({ role }: ApprovalsInboxPageProps) {
  const isAdmin = role === "owner" || role === "admin";

  const [data, setData] = useState<ApprovalsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [bulkApprovingMember, setBulkApprovingMember] = useState<string | null>(null);

  const [rejectTarget, setRejectTarget] = useState<ApprovalRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const fetchApprovals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/approvals");
      if (!res.ok) throw new Error("Failed to load approvals");
      const { data: body } = await res.json();
      setData(body as ApprovalsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) fetchApprovals();
  }, [isAdmin, fetchApprovals]);

  function removeRow(kind: ApprovalRow["kind"], id: string) {
    setData((prev) => {
      if (!prev) return prev;
      const key = kind === "time_entry" ? "timeEntries" : kind === "milestone" ? "milestones" : "changeRequests";
      const nextList = (prev[key] as ApprovalRow[]).filter((r) => r.id !== id);
      return {
        ...prev,
        [key]: nextList,
        counts: {
          ...prev.counts,
          [key]: nextList.length,
          total: prev.counts.total - 1,
        },
      } as ApprovalsData;
    });
  }

  function removeRows(kind: ApprovalRow["kind"], ids: string[]) {
    ids.forEach((id) => removeRow(kind, id));
  }

  async function handleApprove(row: ApprovalRow) {
    setProcessingIds((prev) => new Set(prev).add(row.id));
    const result = await postAction(APPROVE_PATH[row.kind](row.id));
    setProcessingIds((prev) => {
      const next = new Set(prev);
      next.delete(row.id);
      return next;
    });
    if (result.ok) {
      toast.success(`${KIND_LABEL[row.kind]} approved`);
      removeRow(row.kind, row.id);
    } else if (result.conflict) {
      toast.warning("Already handled by someone else");
      removeRow(row.kind, row.id);
    } else {
      toast.error(result.message);
    }
  }

  function handleRejectClick(row: ApprovalRow) {
    setRejectTarget(row);
    setRejectReason("");
  }

  const reasonRequired = rejectTarget?.kind === "time_entry";

  async function handleRejectSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!rejectTarget) return;
    if (reasonRequired && !rejectReason.trim()) return;

    setProcessingIds((prev) => new Set(prev).add(rejectTarget.id));
    const result = await postAction(REJECT_PATH[rejectTarget.kind](rejectTarget.id), rejectReason.trim());
    setProcessingIds((prev) => {
      const next = new Set(prev);
      next.delete(rejectTarget.id);
      return next;
    });
    if (result.ok) {
      toast.success(`${KIND_LABEL[rejectTarget.kind]} rejected`);
      removeRow(rejectTarget.kind, rejectTarget.id);
      setRejectTarget(null);
      setRejectReason("");
    } else if (result.conflict) {
      toast.warning("Already handled by someone else");
      removeRow(rejectTarget.kind, rejectTarget.id);
      setRejectTarget(null);
      setRejectReason("");
    } else {
      toast.error(result.message);
    }
  }

  async function handleApproveAll(group: MemberGroup) {
    setBulkApprovingMember(group.userId);
    const results = await Promise.allSettled(
      group.rows.map((row) =>
        fetch(APPROVE_PATH.time_entry(row.id), { method: "POST" }).then((r) => {
          if (!r.ok) throw new Error(row.id);
          return row.id;
        })
      )
    );
    const succeeded = results.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<string>).value);
    const failed = results.length - succeeded.length;
    if (succeeded.length > 0) removeRows("time_entry", succeeded);
    if (failed === 0) {
      toast.success(`Approved ${succeeded.length} entries for ${group.label}`);
    } else {
      toast.warning(`Approved ${succeeded.length}, failed ${failed} (see console)`);
      console.error("Approve-all partial failure", { group: group.userId, succeeded, failed });
    }
    setBulkApprovingMember(null);
  }

  const memberGroups = useMemo(() => groupTimeEntriesByMember(data?.timeEntries ?? []), [data?.timeEntries]);

  // ── Not authorized ──────────────────────────────────────────────

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-64 text-center">
        <CheckSquare className="h-10 w-10 text-muted-foreground mb-3" />
        <p className="font-medium">You don&apos;t have permission to access approvals</p>
        <p className="text-sm text-muted-foreground mt-1">This page is only available to admins and owners.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return <div className="text-sm text-destructive">Failed to load approvals: {error}</div>;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold">Approvals</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Everything waiting on an admin decision, across change requests, milestones, and time entries.
          </p>
        </div>
        <Badge variant="secondary" className="text-sm px-3 py-1">
          {data.counts.total} pending
        </Badge>
      </div>

      {data.counts.total === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <CheckSquare className="h-12 w-12 mb-4 opacity-40" />
          <p className="font-medium text-base">You&apos;re all caught up!</p>
          <p className="text-sm mt-1">Nothing is waiting on an approval decision.</p>
        </div>
      )}

      {data.changeRequests.length > 0 && (
        <section className="space-y-1">
          <div className="flex items-center gap-2 px-1">
            <FileEdit className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Change requests</h2>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {data.changeRequests.length}
            </Badge>
          </div>
          <div className="space-y-0.5">
            {data.changeRequests.map((row) => (
              <ChangeRequestRow
                key={row.id}
                row={row}
                processing={processingIds.has(row.id)}
                onApprove={handleApprove}
                onRejectClick={handleRejectClick}
              />
            ))}
          </div>
        </section>
      )}

      {data.milestones.length > 0 && (
        <section className="space-y-1">
          <div className="flex items-center gap-2 px-1">
            <Flag className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Milestones</h2>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {data.milestones.length}
            </Badge>
          </div>
          <div className="space-y-0.5">
            {data.milestones.map((row) => (
              <MilestoneRow
                key={row.id}
                row={row}
                processing={processingIds.has(row.id)}
                onApprove={handleApprove}
                onRejectClick={handleRejectClick}
              />
            ))}
          </div>
        </section>
      )}

      {data.timeEntries.length > 0 && (
        <section className="space-y-1">
          <div className="flex items-center gap-2 px-1">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Time entries</h2>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {data.timeEntries.length}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground px-1">
            Bulk-approve by member here; open the full queue for per-entry review or rejecting with a reason.
          </p>
          <div className="space-y-1.5">
            {memberGroups.map((group) => (
              <div key={group.userId} className="flex items-center gap-3 py-2.5 px-4 hover:bg-muted/40 rounded-lg">
                <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                  {group.label[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{group.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {group.rows.length} {group.rows.length === 1 ? "entry" : "entries"} · {formatHours(group.totalMinutes)}
                  </p>
                </div>
                <Button
                  size="sm"
                  className="h-7 px-3 text-xs shrink-0"
                  onClick={() => handleApproveAll(group)}
                  disabled={bulkApprovingMember === group.userId}
                >
                  {bulkApprovingMember === group.userId ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  ) : (
                    <ThumbsUp className="h-3.5 w-3.5 mr-1" />
                  )}
                  Approve all
                </Button>
              </div>
            ))}
          </div>
          <Link
            href="/approvals/time-entries"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline px-1"
          >
            Open full queue <ArrowRight className="h-3 w-3" />
          </Link>
        </section>
      )}

      {/* Reject modal */}
      <Dialog
        open={!!rejectTarget}
        onOpenChange={(open) => {
          if (!open) setRejectTarget(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reject {rejectTarget ? KIND_LABEL[rejectTarget.kind] : ""}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRejectSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="reject-reason">
                Reason {reasonRequired && <span className="text-destructive">*</span>}
                {!reasonRequired && <span className="text-muted-foreground font-normal"> (optional)</span>}
              </Label>
              <Textarea
                id="reject-reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Explain why this is being rejected…"
                maxLength={reasonRequired ? 500 : 2000}
                rows={3}
                required={reasonRequired}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRejectTarget(null)}
                disabled={!!rejectTarget && processingIds.has(rejectTarget.id)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={(!!rejectTarget && processingIds.has(rejectTarget.id)) || (reasonRequired && !rejectReason.trim())}
              >
                {rejectTarget && processingIds.has(rejectTarget.id) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Reject
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

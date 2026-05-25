"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { CheckSquare, Loader2, Clock, ThumbsUp, ThumbsDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { formatMinutes } from "../hooks/use-time-entries";
import type { TimeEntryWithJoins } from "../hooks/use-time-entries";

interface ApprovalsQueuePageProps {
  tenantId: string;
  role: string;
}

// ── Data fetching ────────────────────────────────────────────────

function fourWeeksAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 28);
  return d.toISOString().split("T")[0];
}

function startOfWeek(): string {
  const d = new Date();
  const day = d.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + offset);
  return d.toISOString().split("T")[0];
}

// ── Grouping helpers ─────────────────────────────────────────────

interface MemberGroup {
  userId: string;
  label: string;
  entries: TimeEntryWithJoins[];
}

interface DateGroup {
  date: string;
  label: string;
  entries: TimeEntryWithJoins[];
}

function groupByMember(entries: TimeEntryWithJoins[]): MemberGroup[] {
  const map = new Map<string, TimeEntryWithJoins[]>();
  for (const e of entries) {
    const g = map.get(e.user_id) ?? [];
    g.push(e);
    map.set(e.user_id, g);
  }
  return Array.from(map.entries()).map(([userId, grp]) => ({
    userId,
    label: userId.slice(0, 8) + "…",
    entries: grp.sort((a, b) => b.entry_date.localeCompare(a.entry_date)),
  }));
}

function groupByDate(entries: TimeEntryWithJoins[]): DateGroup[] {
  const map = new Map<string, TimeEntryWithJoins[]>();
  for (const e of entries) {
    const g = map.get(e.entry_date) ?? [];
    g.push(e);
    map.set(e.entry_date, g);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, grp]) => ({
      date,
      label: new Date(date + "T00:00:00").toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
      }),
      entries: grp,
    }));
}

// ── Entry row in approvals queue ─────────────────────────────────

interface ApprovalEntryRowProps {
  entry: TimeEntryWithJoins;
  selected: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onApprove: (id: string) => Promise<void>;
  onRejectClick: (id: string) => void;
  processing: boolean;
}

function ApprovalEntryRow({
  entry,
  selected,
  onSelect,
  onApprove,
  onRejectClick,
  processing,
}: ApprovalEntryRowProps) {
  return (
    <div className="flex items-center gap-3 py-2.5 px-4 hover:bg-muted/40 rounded-lg group">
      <Checkbox
        checked={selected}
        onCheckedChange={(v) => onSelect(entry.id, !!v)}
        aria-label="Select entry"
        className="shrink-0"
      />

      {/* Time */}
      <div className="flex items-center gap-1.5 shrink-0 w-16 text-sm font-medium tabular-nums text-muted-foreground">
        <Clock className="h-3.5 w-3.5" />
        {formatMinutes(entry.minutes)}
      </div>

      {/* Date (shown in member grouping) */}
      <div className="shrink-0 w-24 text-xs text-muted-foreground">
        {new Date(entry.entry_date + "T00:00:00").toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })}
      </div>

      {/* Project / Task */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          {entry.projects?.name ?? "—"}
          {entry.tasks && (
            <span className="text-muted-foreground font-normal"> · {entry.tasks.title}</span>
          )}
        </p>
        {entry.notes && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">{entry.notes}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2.5 text-xs text-green-700 border-green-200 hover:bg-green-50"
          onClick={() => onApprove(entry.id)}
          disabled={processing}
        >
          {processing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <>
              <ThumbsUp className="h-3.5 w-3.5 mr-1" />
              Approve
            </>
          )}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2.5 text-xs text-red-700 border-red-200 hover:bg-red-50"
          onClick={() => onRejectClick(entry.id)}
          disabled={processing}
        >
          <ThumbsDown className="h-3.5 w-3.5 mr-1" />
          Reject
        </Button>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────

export function ApprovalsQueuePage({ role }: ApprovalsQueuePageProps) {
  const isAdmin = role === "owner" || role === "admin";

  const [entries, setEntries] = useState<TimeEntryWithJoins[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selection state
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Per-entry processing (approve/reject in-flight)
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());

  // Reject modal
  const [rejectTarget, setRejectTarget] = useState<string | null>(null); // single id or "bulk"
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);

  // Bulk reject modal
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
  const [bulkRejectReason, setBulkRejectReason] = useState("");
  const [bulkRejecting, setBulkRejecting] = useState(false);

  // Bulk approve
  const [bulkApproving, setBulkApproving] = useState(false);

  const fetchPending = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const from = fourWeeksAgo();
      const res = await fetch(`/api/v1/time-entries?approval_status=pending&from=${from}`);
      if (!res.ok) throw new Error("Failed to load pending entries");
      const { data } = await res.json();
      setEntries((data ?? []) as TimeEntryWithJoins[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPending();
  }, [fetchPending]);

  // Count entries in this week's range for header badge
  const thisWeekStart = startOfWeek();
  const thisWeekPending = entries.filter((e) => e.entry_date >= thisWeekStart).length;

  // ── Selection helpers ──────────────────────────────────────────

  function toggleSelect(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleSelectAll(checked: boolean) {
    setSelected(checked ? new Set(entries.map((e) => e.id)) : new Set());
  }

  const allSelected = entries.length > 0 && selected.size === entries.length;
  const someSelected = selected.size > 0 && !allSelected;

  // ── Remove from local state after action ───────────────────────

  function removeEntries(ids: string[]) {
    setEntries((prev) => prev.filter((e) => !ids.includes(e.id)));
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }

  // ── Single approve ─────────────────────────────────────────────

  async function handleApprove(id: string) {
    setProcessingIds((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/v1/time-entries/${id}/approve`, { method: "POST" });
      if (!res.ok) {
        const { error: apiErr } = await res.json().catch(() => ({}));
        throw new Error(apiErr?.message ?? "Failed to approve");
      }
      toast.success("Entry approved");
      removeEntries([id]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to approve");
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  // ── Single reject ──────────────────────────────────────────────

  function handleRejectClick(id: string) {
    setRejectTarget(id);
    setRejectReason("");
  }

  async function handleRejectSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!rejectTarget || rejectTarget === "bulk") return;
    const id = rejectTarget;
    setRejecting(true);
    try {
      const res = await fetch(`/api/v1/time-entries/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason.trim() }),
      });
      if (!res.ok) {
        const { error: apiErr } = await res.json().catch(() => ({}));
        throw new Error(apiErr?.message ?? "Failed to reject");
      }
      toast.success("Entry rejected");
      removeEntries([id]);
      setRejectTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reject");
    } finally {
      setRejecting(false);
    }
  }

  // ── Bulk approve ───────────────────────────────────────────────

  async function handleBulkApprove() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkApproving(true);
    const results = await Promise.allSettled(
      ids.map((id) =>
        fetch(`/api/v1/time-entries/${id}/approve`, { method: "POST" }).then((r) => {
          if (!r.ok) throw new Error(id);
          return id;
        })
      )
    );
    const succeeded = results.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<string>).value);
    const failed = results.filter((r) => r.status === "rejected").length;
    if (succeeded.length > 0) removeEntries(succeeded);
    if (failed === 0) {
      toast.success(`Approved ${succeeded.length}`);
    } else {
      toast.warning(`Approved ${succeeded.length}, failed ${failed} (see console)`);
      console.error("Bulk approve partial failure:", { succeeded, failed });
    }
    setBulkApproving(false);
  }

  // ── Bulk reject ────────────────────────────────────────────────

  async function handleBulkRejectSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkRejecting(true);
    const reason = bulkRejectReason.trim();
    const results = await Promise.allSettled(
      ids.map((id) =>
        fetch(`/api/v1/time-entries/${id}/reject`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        }).then((r) => {
          if (!r.ok) throw new Error(id);
          return id;
        })
      )
    );
    const succeeded = results.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<string>).value);
    const failed = results.filter((r) => r.status === "rejected").length;
    if (succeeded.length > 0) removeEntries(succeeded);
    if (failed === 0) {
      toast.success(`Rejected ${succeeded.length}`);
    } else {
      toast.warning(`Rejected ${succeeded.length}, failed ${failed} (see console)`);
    }
    setBulkRejecting(false);
    setBulkRejectOpen(false);
    setBulkRejectReason("");
  }

  // ── Groupings ──────────────────────────────────────────────────

  const memberGroups = useMemo(() => groupByMember(entries), [entries]);
  const dateGroups = useMemo(() => groupByDate(entries), [entries]);

  // ── Not authorized ─────────────────────────────────────────────

  if (!isAdmin) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-64 text-center">
        <CheckSquare className="h-10 w-10 text-muted-foreground mb-3" />
        <p className="font-medium">You don&apos;t have permission to access approvals</p>
        <p className="text-sm text-muted-foreground mt-1">
          This page is only available to admins and owners.
        </p>
      </div>
    );
  }

  // ── Loading / error ────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-sm text-destructive">
        Failed to load pending entries: {error}
      </div>
    );
  }

  // ── Queue ──────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Approvals Queue</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Review and approve your team&apos;s pending time entries.
          </p>
        </div>
        <Badge variant="secondary" className="text-sm px-3 py-1">
          This week: {thisWeekPending} pending
        </Badge>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 p-3 bg-muted/60 rounded-lg">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button
            size="sm"
            className="h-7 px-3 text-xs bg-green-600 hover:bg-green-700 text-white"
            onClick={handleBulkApprove}
            disabled={bulkApproving}
          >
            {bulkApproving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <ThumbsUp className="h-3.5 w-3.5 mr-1" />
            )}
            Approve selected
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-3 text-xs text-red-700 border-red-200 hover:bg-red-50"
            onClick={() => {
              setBulkRejectOpen(true);
              setBulkRejectReason("");
            }}
            disabled={bulkApproving}
          >
            <ThumbsDown className="h-3.5 w-3.5 mr-1" />
            Reject selected
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-3 text-xs ml-auto"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </Button>
        </div>
      )}

      {/* Empty state */}
      {entries.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <CheckSquare className="h-12 w-12 mb-4 opacity-40" />
          <p className="font-medium text-base">No pending entries — all caught up!</p>
          <p className="text-sm mt-1">All time entries from the last 4 weeks are reviewed.</p>
        </div>
      )}

      {/* Queue table */}
      {entries.length > 0 && (
        <Tabs defaultValue="by-member">
          <TabsList>
            <TabsTrigger value="by-member">By member</TabsTrigger>
            <TabsTrigger value="by-date">By date</TabsTrigger>
          </TabsList>

          {/* Select-all row */}
          <div className="flex items-center gap-3 py-2 px-4 mt-3 border-b text-xs text-muted-foreground font-medium">
            <Checkbox
              checked={someSelected ? "indeterminate" : allSelected}
              onCheckedChange={(v) => toggleSelectAll(v === true)}
              aria-label="Select all"
              className="shrink-0"
            />
            <span className="w-16">Time</span>
            <span className="w-24">Date</span>
            <span className="flex-1">Project / Task</span>
            <span className="w-28">Actions</span>
          </div>

          <TabsContent value="by-member" className="mt-0">
            {memberGroups.map((group) => (
              <div key={group.userId} className="mt-4">
                <div className="px-4 py-1.5 flex items-center gap-2">
                  <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">
                    {group.userId[0].toUpperCase()}
                  </div>
                  <span className="text-sm font-semibold">{group.label}</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {group.entries.length}
                  </Badge>
                </div>
                <div className="space-y-0.5">
                  {group.entries.map((entry) => (
                    <ApprovalEntryRow
                      key={entry.id}
                      entry={entry}
                      selected={selected.has(entry.id)}
                      onSelect={toggleSelect}
                      onApprove={handleApprove}
                      onRejectClick={handleRejectClick}
                      processing={processingIds.has(entry.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="by-date" className="mt-0">
            {dateGroups.map((group) => (
              <div key={group.date} className="mt-4">
                <div className="px-4 py-1.5 flex items-center gap-2">
                  <span className="text-sm font-semibold">{group.label}</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {group.entries.length}
                  </Badge>
                </div>
                <div className="space-y-0.5">
                  {group.entries.map((entry) => (
                    <ApprovalEntryRow
                      key={entry.id}
                      entry={entry}
                      selected={selected.has(entry.id)}
                      onSelect={toggleSelect}
                      onApprove={handleApprove}
                      onRejectClick={handleRejectClick}
                      processing={processingIds.has(entry.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </TabsContent>
        </Tabs>
      )}

      {/* Single reject modal */}
      <Dialog
        open={!!rejectTarget}
        onOpenChange={(open) => {
          if (!open) setRejectTarget(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reject Time Entry</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRejectSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="reject-reason">
                Reason <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="reject-reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Explain why this entry is being rejected…"
                maxLength={500}
                rows={3}
                required
              />
              <p className="text-xs text-muted-foreground text-right">
                {rejectReason.length}/500
              </p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRejectTarget(null)}
                disabled={rejecting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={rejecting || !rejectReason.trim()}
              >
                {rejecting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Reject
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Bulk reject modal */}
      <Dialog open={bulkRejectOpen} onOpenChange={setBulkRejectOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reject {selected.size} entries</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleBulkRejectSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="bulk-reject-reason">
                Shared reason <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="bulk-reject-reason"
                value={bulkRejectReason}
                onChange={(e) => setBulkRejectReason(e.target.value)}
                placeholder="Explain why these entries are being rejected…"
                maxLength={500}
                rows={3}
                required
              />
              <p className="text-xs text-muted-foreground text-right">
                {bulkRejectReason.length}/500
              </p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setBulkRejectOpen(false)}
                disabled={bulkRejecting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={bulkRejecting || !bulkRejectReason.trim()}
              >
                {bulkRejecting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Reject all
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

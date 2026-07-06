"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, CheckSquare, ThumbsUp, ThumbsDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useLeaveApproveReject } from "./use-leave-approve-reject";
import type { LeaveRequestRow } from "./types";

interface TeamLeavePanelProps {
  canManageHR: boolean;
}

export function TeamLeavePanel({ canManageHR }: TeamLeavePanelProps) {
  const [scope, setScope] = useState<"team" | "all">("team");
  const [requests, setRequests] = useState<LeaveRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async (currentScope: "team" | "all") => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/leave/requests?scope=${currentScope}&status=pending`);
      if (!res.ok) throw new Error("Failed to load pending leave requests");
      const { data } = await res.json();
      setRequests((data ?? []) as LeaveRequestRow[]);
    } catch {
      toast.error("Failed to load pending leave requests");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(scope);
  }, [scope, load]);

  function removeRequest(id: string) {
    setRequests((prev) => prev.filter((r) => r.id !== id));
  }

  const { approve, reject, processingIds } = useLeaveApproveReject({
    onSuccess: (id, action) => {
      removeRequest(id);
      if (action === "reject") {
        setRejectTarget(null);
        setRejectReason("");
      }
    },
  });

  async function handleRejectSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!rejectTarget) return;
    await reject(rejectTarget, rejectReason.trim());
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Team Leave — Pending Approvals</h2>
        {canManageHR && (
          <Select value={scope} onValueChange={(v) => setScope(v as "team" | "all")}>
            <SelectTrigger className="w-40 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="team">My reports</SelectItem>
              <SelectItem value="all">All (tenant)</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-32">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
          <CheckSquare className="h-10 w-10 mb-3 opacity-40" />
          <p className="font-medium">No pending leave requests</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead>Days</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead className="w-28">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  {r.leave_types?.name ?? "—"}
                  {!r.leave_types?.is_paid && (
                    <Badge variant="outline" className="ml-1.5 text-[10px] px-1 py-0">
                      Unpaid
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  {r.start_date}
                  {r.end_date !== r.start_date ? ` – ${r.end_date}` : ""}
                </TableCell>
                <TableCell className="tabular-nums">{r.total_days}</TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-56 truncate">
                  {r.reason ?? "—"}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => approve(r.id)}
                      disabled={processingIds.has(r.id)}
                      title="Approve"
                    >
                      {processingIds.has(r.id) ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ThumbsUp className="h-3.5 w-3.5 text-emerald-600" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        setRejectTarget(r.id);
                        setRejectReason("");
                      }}
                      disabled={processingIds.has(r.id)}
                      title="Reject"
                    >
                      <ThumbsDown className="h-3.5 w-3.5 text-red-600" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={!!rejectTarget} onOpenChange={(open) => { if (!open) setRejectTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reject Leave Request</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRejectSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="leave-reject-reason">
                Reason <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="leave-reject-reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Explain why this request is being rejected…"
                maxLength={500}
                rows={3}
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRejectTarget(null)}
                disabled={processingIds.has(rejectTarget ?? "")}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={processingIds.has(rejectTarget ?? "") || !rejectReason.trim()}
              >
                {processingIds.has(rejectTarget ?? "") && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Reject
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

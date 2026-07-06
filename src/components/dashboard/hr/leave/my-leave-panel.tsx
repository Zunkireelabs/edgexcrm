"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { LeaveTypeOption, LeaveRequestRow } from "./types";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  approved: "default",
  rejected: "destructive",
  cancelled: "outline",
};

export function MyLeavePanel() {
  const [balances, setBalances] = useState<LeaveTypeOption[]>([]);
  const [requests, setRequests] = useState<LeaveRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);

  const [leaveTypeId, setLeaveTypeId] = useState<string>("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startHalf, setStartHalf] = useState(false);
  const [endHalf, setEndHalf] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [balancesRes, requestsRes] = await Promise.all([
        fetch("/api/v1/leave/balances"),
        fetch("/api/v1/leave/requests?scope=mine"),
      ]);
      if (balancesRes.ok) {
        const d = await balancesRes.json();
        setBalances(d.data ?? []);
      }
      if (requestsRes.ok) {
        const d = await requestsRes.json();
        setRequests(d.data ?? []);
      }
    } catch {
      toast.error("Failed to load leave data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selectedType = balances.find((b) => b.leave_type_id === leaveTypeId);

  function resetForm() {
    setLeaveTypeId("");
    setStartDate("");
    setEndDate("");
    setStartHalf(false);
    setEndHalf(false);
    setReason("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!leaveTypeId || !startDate || !endDate) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/leave/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leave_type_id: leaveTypeId,
          start_date: startDate,
          end_date: endDate,
          start_half: startHalf,
          end_half: endHalf,
          reason: reason.trim() || undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? "Failed to submit leave request");
      toast.success(`Leave requested — ${d.data.total_days} day${d.data.total_days === 1 ? "" : "s"}`);
      setSheetOpen(false);
      resetForm();
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit leave request");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(id: string) {
    if (!confirm("Cancel this leave request?")) return;
    setCancellingId(id);
    try {
      const res = await fetch(`/api/v1/leave/requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approval_status: "cancelled" }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? "Failed to cancel request");
      setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, approval_status: "cancelled" } : r)));
      toast.success("Leave request cancelled");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel request");
    } finally {
      setCancellingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-48">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">My Leave</h2>
        <Button size="sm" onClick={() => setSheetOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Request leave
        </Button>
      </div>

      {/* Balance cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {balances.map((b) => (
          <Card key={b.leave_type_id}>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                {b.color && (
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: b.color }} />
                )}
                {b.name}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tabular-nums">{b.balance}</p>
              <p className="text-xs text-muted-foreground">
                of {b.annual_allotment_days + b.adjustments} days left
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* My requests */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-2">My requests</h3>
        {requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">No leave requests yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Days</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.leave_types?.name ?? "—"}</TableCell>
                  <TableCell className="text-sm">
                    {r.start_date}
                    {r.end_date !== r.start_date ? ` – ${r.end_date}` : ""}
                  </TableCell>
                  <TableCell className="tabular-nums">{r.total_days}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[r.approval_status] ?? "outline"} className="capitalize">
                      {r.approval_status}
                    </Badge>
                    {r.approval_status === "rejected" && r.rejection_reason && (
                      <p className="text-xs text-muted-foreground mt-0.5">{r.rejection_reason}</p>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.approval_status === "pending" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handleCancel(r.id)}
                        disabled={cancellingId === r.id}
                        title="Cancel"
                      >
                        <X className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Request leave sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Request Leave</SheetTitle>
          </SheetHeader>
          <form onSubmit={handleSubmit} className="space-y-4 px-4">
            <div className="space-y-1.5">
              <Label>Leave type</Label>
              <Select value={leaveTypeId} onValueChange={setLeaveTypeId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a leave type" />
                </SelectTrigger>
                <SelectContent>
                  {balances.map((b) => (
                    <SelectItem key={b.leave_type_id} value={b.leave_type_id}>
                      {b.name} ({b.balance} left)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="start-date">Start date</Label>
                <Input
                  id="start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="end-date">End date</Label>
                <Input
                  id="end-date"
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                />
              </div>
            </div>

            {selectedType?.allow_half_day && (
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 text-sm">
                  <Checkbox checked={startHalf} onCheckedChange={(v) => setStartHalf(!!v)} />
                  Start half-day
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <Checkbox checked={endHalf} onCheckedChange={(v) => setEndHalf(!!v)} />
                  End half-day
                </label>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="reason">Reason (optional)</Label>
              <Textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                maxLength={500}
              />
            </div>

            <SheetFooter className="px-0">
              <Button
                type="submit"
                disabled={submitting || !leaveTypeId || !startDate || !endDate}
                className="w-full"
              >
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Submit request
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}

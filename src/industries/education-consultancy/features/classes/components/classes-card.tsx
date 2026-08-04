"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Loader2, MoreHorizontal, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { AddEnrollmentToLeadSheet } from "./add-enrollment-to-lead-sheet";

interface Enrollment {
  id: string;
  class_id: string;
  fee_paid: boolean;
  fee_amount: number | null;
  enrollment_type: "demo" | "actual";
  status: "active" | "inactive" | "completed";
  created_at: string;
  classes?: {
    id: string;
    name: string;
    default_fee: number | null;
  } | null;
}

const STATUS_STYLES: Record<Enrollment["status"], string> = {
  active: "bg-green-50 text-green-700 border-green-200",
  completed: "bg-blue-50 text-blue-700 border-blue-200",
  inactive: "bg-muted text-muted-foreground",
};

interface ClassesCardProps {
  leadId: string;
  canManage: boolean;
}

export function ClassesCard({ leadId, canManage }: ClassesCardProps) {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [markPaidTarget, setMarkPaidTarget] = useState<Enrollment | null>(null);
  const [feeAmountInput, setFeeAmountInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);

  const fetchEnrollments = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/classes`);
      if (!res.ok) throw new Error("Failed to fetch");
      const { data } = await res.json();
      setEnrollments(data ?? []);
    } catch {
      // silently fail
    }
  }, [leadId]);

  useEffect(() => {
    setLoading(true);
    fetchEnrollments().finally(() => setLoading(false));
  }, [fetchEnrollments]);

  async function handleToggleFeePaid(enrollment: Enrollment) {
    if (!enrollment.fee_paid) {
      // Marking paid — collect the amount instead of PATCHing blind.
      setFeeAmountInput(enrollment.fee_amount != null ? String(enrollment.fee_amount) : (enrollment.classes?.default_fee != null ? String(enrollment.classes.default_fee) : ""));
      setMarkPaidTarget(enrollment);
      return;
    }
    try {
      const res = await fetch(`/api/v1/class-enrollments/${enrollment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fee_paid: false }),
      });
      if (!res.ok) throw new Error("Failed to update");
      toast.success("Marked unpaid");
      fetchEnrollments();
    } catch {
      toast.error("Failed to update enrollment");
    }
  }

  async function handleConfirmMarkPaid() {
    if (!markPaidTarget) return;
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { fee_paid: true };
      if (feeAmountInput.trim()) body.fee_amount = Number(feeAmountInput);
      const res = await fetch(`/api/v1/class-enrollments/${markPaidTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to update");
      toast.success("Marked paid");
      setMarkPaidTarget(null);
      fetchEnrollments();
    } catch {
      toast.error("Failed to update enrollment");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStatusChange(enrollment: Enrollment, status: Enrollment["status"]) {
    if (status === enrollment.status) return;
    setStatusUpdatingId(enrollment.id);
    try {
      const res = await fetch(`/api/v1/class-enrollments/${enrollment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed to update");
      toast.success("Status updated");
      fetchEnrollments();
    } catch {
      toast.error("Failed to update status");
    } finally {
      setStatusUpdatingId(null);
    }
  }

  async function handleUnenroll(enrollment: Enrollment) {
    const className = enrollment.classes?.name ?? "this class";
    if (!confirm(`Un-enroll from ${className}?`)) return;
    try {
      const res = await fetch(`/api/v1/class-enrollments/${enrollment.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to un-enroll");
      toast.success("Un-enrolled");
      fetchEnrollments();
    } catch {
      toast.error("Failed to un-enroll");
    }
  }

  return (
    <>
      <Card className="shadow-none rounded-lg py-0">
        <CardHeader className="pt-4 pb-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-2">
              Classes
              {!loading && (
                <Badge variant="secondary" className="h-5 px-1.5 text-xs normal-case">
                  {enrollments.length}
                </Badge>
              )}
            </span>
            {canManage && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={() => setAddOpen(true)}
                title="Add to Class"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="pb-4">
          {loading ? (
            <div className="flex justify-center py-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : enrollments.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-2">Not enrolled in any class yet.</p>
          ) : (
            <div className="space-y-2">
              {enrollments.map((enrollment) => {
                const className = enrollment.classes?.name ?? "Unknown class";
                const isUpdating = statusUpdatingId === enrollment.id;
                return (
                  <div
                    key={enrollment.id}
                    className="border rounded-md p-3 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium truncate">{className}</p>
                      {canManage && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 -mt-0.5" disabled={isUpdating}>
                              {isUpdating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MoreHorizontal className="h-3.5 w-3.5" />}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuSub>
                              <DropdownMenuSubTrigger>Change status</DropdownMenuSubTrigger>
                              <DropdownMenuSubContent>
                                {(["active", "inactive", "completed"] as const).map((s) => (
                                  <DropdownMenuItem
                                    key={s}
                                    disabled={s === enrollment.status}
                                    onClick={() => handleStatusChange(enrollment, s)}
                                  >
                                    <span className={`h-1.5 w-1.5 rounded-full mr-2 ${
                                      s === "active" ? "bg-green-600" : s === "completed" ? "bg-blue-600" : "bg-muted-foreground"
                                    }`} />
                                    <span className="capitalize">{s}</span>
                                    {s === enrollment.status && <Check className="h-3 w-3 ml-auto" />}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuSubContent>
                            </DropdownMenuSub>
                            <DropdownMenuItem onClick={() => handleToggleFeePaid(enrollment)}>
                              {enrollment.fee_paid ? "Mark unpaid" : "Mark paid"}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => handleUnenroll(enrollment)}
                            >
                              Un-enroll
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      {enrollment.enrollment_type === "demo" && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-amber-50 text-amber-700 border-amber-200">
                          Demo
                        </Badge>
                      )}
                      <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 capitalize ${STATUS_STYLES[enrollment.status]}`}>
                        {enrollment.status}
                      </Badge>
                      {enrollment.fee_paid ? (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-green-50 text-green-700 border-green-200">
                          <Check className="h-2.5 w-2.5 mr-0.5" />
                          Paid
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
                          <X className="h-2.5 w-2.5 mr-0.5" />
                          Unpaid
                        </Badge>
                      )}
                      {enrollment.fee_amount != null && (
                        <span className="text-xs text-muted-foreground">
                          {enrollment.fee_amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Started {new Date(enrollment.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <AddEnrollmentToLeadSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        leadId={leadId}
        onSuccess={() => {
          setAddOpen(false);
          fetchEnrollments();
        }}
      />

      <Dialog open={!!markPaidTarget} onOpenChange={(open) => !open && setMarkPaidTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Mark as paid</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label className="text-xs text-gray-600">Amount</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={feeAmountInput}
              onChange={(e) => setFeeAmountInput(e.target.value)}
              placeholder="0.00"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkPaidTarget(null)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleConfirmMarkPaid} disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Mark paid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

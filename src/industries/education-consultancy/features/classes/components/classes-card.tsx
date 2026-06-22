"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Loader2, MoreHorizontal, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { AddEnrollmentToLeadSheet } from "./add-enrollment-to-lead-sheet";

interface Enrollment {
  id: string;
  class_id: string;
  fee_paid: boolean;
  fee_amount: number | null;
  created_at: string;
  classes?: {
    id: string;
    name: string;
    default_fee: number | null;
  } | null;
}

interface ClassesCardProps {
  leadId: string;
  canManage: boolean;
}

export function ClassesCard({ leadId, canManage }: ClassesCardProps) {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

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
    try {
      const res = await fetch(`/api/v1/class-enrollments/${enrollment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fee_paid: !enrollment.fee_paid }),
      });
      if (!res.ok) throw new Error("Failed to update");
      toast.success(enrollment.fee_paid ? "Marked unpaid" : "Marked paid");
      fetchEnrollments();
    } catch {
      toast.error("Failed to update enrollment");
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
                return (
                  <div
                    key={enrollment.id}
                    className="flex items-start justify-between border rounded-md p-3 gap-2"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{className}</p>
                      <div className="flex items-center gap-1.5 mt-1">
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
                    </div>
                    {canManage && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleToggleFeePaid(enrollment)}>
                            {enrollment.fee_paid ? "Mark unpaid" : "Mark paid"}
                          </DropdownMenuItem>
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
    </>
  );
}

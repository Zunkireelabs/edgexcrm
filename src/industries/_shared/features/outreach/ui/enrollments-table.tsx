"use client";

import { useState, useEffect, useCallback } from "react";
import { Pause, Play, UserX, Loader2, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { formatDate } from "../lib/format-due";

type EnrollmentStatus = "active" | "paused" | "completed" | "unenrolled";

interface Enrollment {
  id: string;
  lead_id: string;
  assigned_to: string | null;
  status: EnrollmentStatus;
  current_step_order: number;
  started_at: string;
  email_sequences: { name: string } | null;
  leads: { first_name: string | null; last_name: string | null } | null;
}

const STATUS_FILTERS: { value: EnrollmentStatus | "all"; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
  { value: "all", label: "All" },
];

const STATUS_VARIANT: Record<EnrollmentStatus, "default" | "secondary" | "outline"> = {
  active: "default",
  paused: "secondary",
  completed: "outline",
  unenrolled: "outline",
};

interface EnrollmentsTableProps {
  isAdmin: boolean;
  currentUserId?: string;
}

export function EnrollmentsTable({ isAdmin, currentUserId }: EnrollmentsTableProps) {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<EnrollmentStatus | "all">("active");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [unenrollTarget, setUnenrollTarget] = useState<Enrollment | null>(null);

  const fetchEnrollments = useCallback(async () => {
    setLoading(true);
    try {
      const params = status === "all" ? "" : `?status=${status}`;
      const res = await fetch(`/api/v1/outreach/enrollments${params}`);
      if (res.ok) {
        const json = await res.json();
        setEnrollments(json.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    fetchEnrollments();
  }, [fetchEnrollments]);

  const canManage = (enrollment: Enrollment) => isAdmin || enrollment.assigned_to === currentUserId;

  const runAction = async (enrollment: Enrollment, action: "pause" | "resume" | "unenroll") => {
    setBusyId(enrollment.id);
    try {
      const res = await fetch(`/api/v1/outreach/enrollments/${enrollment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        toast.error(json?.error?.message ?? "Failed to update enrollment");
        return;
      }
      toast.success(
        action === "pause" ? "Enrollment paused" : action === "resume" ? "Enrollment resumed" : "Lead unenrolled",
      );
      fetchEnrollments();
    } finally {
      setBusyId(null);
      setUnenrollTarget(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        {STATUS_FILTERS.map((f) => (
          <Button
            key={f.value}
            type="button"
            variant={status === f.value ? "default" : "outline"}
            size="sm"
            onClick={() => setStatus(f.value)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {loading ? (
        <Card className="shadow-none rounded-lg py-0">
          <CardContent className="p-8 text-center text-muted-foreground">Loading enrollments...</CardContent>
        </Card>
      ) : enrollments.length === 0 ? (
        <Card className="shadow-none rounded-lg py-0">
          <CardContent className="p-8 text-center">
            <Users className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground">No enrollments in this view.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lead</TableHead>
                <TableHead>Sequence</TableHead>
                <TableHead>Step</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Started</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {enrollments.map((enrollment) => {
                const leadName =
                  [enrollment.leads?.first_name, enrollment.leads?.last_name].filter(Boolean).join(" ") ||
                  enrollment.lead_id;
                const busy = busyId === enrollment.id;
                const manageable = canManage(enrollment);
                return (
                  <TableRow key={enrollment.id}>
                    <TableCell className="font-medium">{leadName}</TableCell>
                    <TableCell>{enrollment.email_sequences?.name ?? "—"}</TableCell>
                    <TableCell>{enrollment.current_step_order}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[enrollment.status]}>{enrollment.status}</Badge>
                    </TableCell>
                    <TableCell>{formatDate(enrollment.started_at)}</TableCell>
                    <TableCell className="text-right">
                      {manageable && (enrollment.status === "active" || enrollment.status === "paused") && (
                        <div className="flex justify-end gap-1">
                          {busy ? (
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          ) : (
                            <>
                              {enrollment.status === "active" ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  title="Pause"
                                  onClick={() => runAction(enrollment, "pause")}
                                >
                                  <Pause className="h-3.5 w-3.5" />
                                </Button>
                              ) : (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  title="Resume"
                                  onClick={() => runAction(enrollment, "resume")}
                                >
                                  <Play className="h-3.5 w-3.5" />
                                </Button>
                              )}
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                title="Unenroll"
                                onClick={() => setUnenrollTarget(enrollment)}
                              >
                                <UserX className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog open={!!unenrollTarget} onOpenChange={(open) => !open && setUnenrollTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unenroll this lead?</AlertDialogTitle>
            <AlertDialogDescription>
              This interrupts the cadence — any pending draft is dropped and won&apos;t send.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => unenrollTarget && runAction(unenrollTarget, "unenroll")}>
              Unenroll
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Check, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Status = "present" | "absent" | null;

interface StudentRow {
  enrollment_id: string;
  lead_id: string;
  name: string;
  status: Status;
}

interface AttendanceSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classId: string;
  className: string;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function AttendanceSheet({ open, onOpenChange, classId, className }: AttendanceSheetProps) {
  const [date, setDate] = useState(todayStr());
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [students, setStudents] = useState<StudentRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/classes/${classId}/attendance?date=${date}`);
      if (!res.ok) throw new Error("Failed to load attendance");
      const { data } = await res.json();
      setStudents(data.students ?? []);
    } catch {
      toast.error("Failed to load attendance");
      setStudents([]);
    } finally {
      setLoading(false);
    }
  }, [classId, date]);

  useEffect(() => {
    if (open) load();
    if (!open) setDate(todayStr());
  }, [open, load]);

  function setStatus(enrollmentId: string, status: Status) {
    setStudents((prev) =>
      prev.map((s) => (s.enrollment_id === enrollmentId ? { ...s, status: s.status === status ? null : status } : s))
    );
  }

  async function handleSave() {
    const records = students
      .filter((s) => s.status !== null)
      .map((s) => ({ enrollment_id: s.enrollment_id, status: s.status }));

    if (records.length === 0) {
      toast.error("Mark at least one student first");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/classes/${classId}/attendance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, records }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error?.message ?? "Failed to save attendance");
      }
      toast.success("Attendance saved");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save attendance");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col">
        <SheetHeader className="shrink-0 border-b pb-4">
          <SheetTitle>Attendance — {className}</SheetTitle>
          <SheetDescription>Mark each enrolled student Present or Absent for the selected date.</SheetDescription>
        </SheetHeader>

        <div className="shrink-0 px-4 pt-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-gray-600">Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : students.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No students enrolled in this class.</p>
          ) : (
            <div className="divide-y">
              {students.map((s) => (
                <div key={s.enrollment_id} className="flex items-center justify-between py-2.5">
                  <span className="text-sm font-medium">{s.name}</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setStatus(s.enrollment_id, "present")}
                      className={cn(
                        "flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors",
                        s.status === "present"
                          ? "bg-green-50 text-green-700 border-green-300"
                          : "text-muted-foreground border-transparent hover:bg-muted"
                      )}
                    >
                      <Check className="h-3.5 w-3.5" />
                      Present
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatus(s.enrollment_id, "absent")}
                      className={cn(
                        "flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors",
                        s.status === "absent"
                          ? "bg-red-50 text-red-700 border-red-300"
                          : "text-muted-foreground border-transparent hover:bg-muted"
                      )}
                    >
                      <X className="h-3.5 w-3.5" />
                      Absent
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <SheetFooter className="shrink-0 border-t pt-4">
          <div className="flex w-full gap-4">
            <Button className="flex-1" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleSave} disabled={submitting || loading || students.length === 0}>
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Attendance
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

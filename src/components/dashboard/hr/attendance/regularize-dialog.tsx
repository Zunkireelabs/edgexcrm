"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { AttendanceDay } from "./types";

const STATUS_OPTIONS = [
  { value: "present", label: "Present" },
  { value: "remote", label: "Remote" },
  { value: "half_day", label: "Half day" },
  { value: "absent", label: "Absent" },
];

function toTimeInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function toISOOrNull(dateISO: string, time: string): string | null {
  if (!time) return null;
  return new Date(`${dateISO}T${time}:00`).toISOString();
}

interface RegularizeDialogProps {
  open: boolean;
  tenantUserId: string;
  date: string;
  memberName: string;
  existingDay: AttendanceDay | null;
  onClose: () => void;
  onSaved: () => void;
}

export function RegularizeDialog({
  open,
  tenantUserId,
  date,
  memberName,
  existingDay,
  onClose,
  onSaved,
}: RegularizeDialogProps) {
  const initialStatus =
    existingDay && ["present", "remote", "half_day", "absent"].includes(existingDay.status)
      ? existingDay.status
      : "present";
  const [status, setStatus] = useState<string>(initialStatus);
  const [clockIn, setClockIn] = useState(toTimeInput(existingDay?.clock_in_at ?? null));
  const [clockOut, setClockOut] = useState(toTimeInput(existingDay?.clock_out_at ?? null));
  const [note, setNote] = useState(existingDay?.note ?? "");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/attendance/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_user_id: tenantUserId,
          work_date: date,
          status,
          clock_in_at: toISOOrNull(date, clockIn),
          clock_out_at: toISOOrNull(date, clockOut),
          note: note.trim() || null,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? "Failed to regularize attendance");
      toast.success("Attendance updated");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to regularize attendance");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Regularize Attendance</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {memberName} — {date}
          </p>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="clock-in-time">Clock in</Label>
              <Input id="clock-in-time" type="time" value={clockIn} onChange={(e) => setClockIn(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="clock-out-time">Clock out</Label>
              <Input id="clock-out-time" type="time" value={clockOut} onChange={(e) => setClockOut(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="regularize-note">Note (optional)</Label>
            <Textarea
              id="regularize-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={500}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState, useEffect } from "react";
import { CircleNotchIcon } from "@/components/icons";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogKeyHint, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ClassOption {
  id: string;
  name: string;
  default_fee: number | null;
}

interface AddEnrollmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  /** Called after a saved enrollment (so the list refreshes); the dialog closes itself. */
  onSaved: () => void;
  leadName?: string;
}

/** Enroll a lead in a class — a Dialogs v1 form dialog (was a side sheet; EDGEX-154). Same fields, same API call. */
export function AddEnrollmentDialog({
  open,
  onOpenChange,
  leadId,
  onSaved,
  leadName,
}: AddEnrollmentDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [classId, setClassId] = useState("");
  const [enrollmentType, setEnrollmentType] = useState<"demo" | "actual">("actual");
  const [feePaid, setFeePaid] = useState(false);
  const [feeAmount, setFeeAmount] = useState("");
  const [notes, setNotes] = useState("");

  const selectedClass = classes.find((c) => c.id === classId);

  useEffect(() => {
    if (!open) {
      setFeePaid(false);
      setFeeAmount("");
      setNotes("");
      setClassId("");
    }
    if (open) setEnrollmentType("actual");
  }, [open]);

  // Load active classes when sheet opens
  useEffect(() => {
    if (!open) return;
    fetch("/api/v1/classes")
      .then((r) => r.ok ? r.json() : null)
      .then((j) => {
        if (j?.data) {
          setClasses(j.data);
          if (j.data.length > 0 && !classId) setClassId(j.data[0].id);
        }
      })
      .catch(() => {});
  }, [open, classId]);

  // Pre-fill fee amount from class default_fee when fee paid is toggled on
  useEffect(() => {
    if (feePaid && feeAmount === "" && selectedClass?.default_fee != null) {
      setFeeAmount(String(selectedClass.default_fee));
    }
    if (!feePaid) setFeeAmount("");
  }, [feePaid, selectedClass, feeAmount]);

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (submitting) return;
    if (!classId) { toast.error("Select a class"); return; }

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        class_id: classId,
        enrollment_type: enrollmentType,
        fee_paid: feePaid,
      };
      if (feePaid && feeAmount.trim()) body.fee_amount = Number(feeAmount);
      if (notes.trim()) body.notes = notes.trim();

      const res = await fetch(`/api/v1/leads/${leadId}/classes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error?.message ?? "Failed to add enrollment");
      }

      toast.success("Enrollment added");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add enrollment");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!submitting) onOpenChange(next); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Add to class</DialogTitle>
          <DialogDescription>{leadName ? `For ${leadName}` : "Enroll this student in a class."}</DialogDescription>
        </DialogHeader>

        <form
          id="add-enrollment-form"
          onSubmit={handleSubmit}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && classId) { e.preventDefault(); void handleSubmit(); } }}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <Label>
              Class <span className="text-destructive">*</span>
            </Label>
            <SearchableSelect
              aria-label="Class"
              value={classId}
              onValueChange={setClassId}
              placeholder="Select class"
              searchPlaceholder="Search classes…"
              options={classes.map((c) => ({ value: c.id, label: c.name }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Enrollment type</Label>
            <SegmentedControl
              aria-label="Enrollment type"
              value={enrollmentType}
              onValueChange={(v) => setEnrollmentType(v as "demo" | "actual")}
              items={[{ value: "actual", label: "Actual class" }, { value: "demo", label: "Demo (2-3 day trial)" }]}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Fee paid?</Label>
              <Select value={feePaid ? "paid" : "unpaid"} onValueChange={(v) => setFeePaid(v === "paid")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unpaid">Not paid</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {feePaid && (
              <div className="space-y-1.5">
                <Label htmlFor="enroll-fee-amount">Amount (Rs)</Label>
                <Input id="enroll-fee-amount" type="number" min="0" step="0.01" value={feeAmount} onChange={(e) => setFeeAmount(e.target.value)} placeholder="0.00" />
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="enroll-notes">Notes</Label>
            <Input id="enroll-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" />
          </div>
        </form>

        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button type="submit" form="add-enrollment-form" disabled={submitting || !classId}>
            {submitting && <CircleNotchIcon className="h-4 w-4 animate-spin" />}
            Add to class <DialogKeyHint>↵</DialogKeyHint>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

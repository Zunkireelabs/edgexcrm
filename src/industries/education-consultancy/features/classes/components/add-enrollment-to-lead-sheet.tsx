"use client";

import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
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

interface AddEnrollmentToLeadSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  onSuccess: () => void;
}

export function AddEnrollmentToLeadSheet({
  open,
  onOpenChange,
  leadId,
  onSuccess,
}: AddEnrollmentToLeadSheetProps) {
  const [submitting, setSubmitting] = useState(false);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [classId, setClassId] = useState("");
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!classId) { toast.error("Select a class"); return; }

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        class_id: classId,
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
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add enrollment");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add to Class</SheetTitle>
          <SheetDescription>Enroll this student in a class.</SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-gray-600">
              Class <span className="text-destructive">*</span>
            </Label>
            <Select value={classId} onValueChange={setClassId}>
              <SelectTrigger>
                <SelectValue placeholder="Select class" />
              </SelectTrigger>
              <SelectContent>
                {classes.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-xs text-gray-600">Fee Paid?</Label>
            <button
              type="button"
              onClick={() => setFeePaid((v) => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${feePaid ? "bg-primary" : "bg-muted"}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${feePaid ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>

          {feePaid && (
            <div className="space-y-1.5">
              <Label className="text-xs text-gray-600">Amount</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={feeAmount}
                onChange={(e) => setFeeAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs text-gray-600">Notes</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes"
            />
          </div>
        </form>

        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !classId}
          >
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Add to Class
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

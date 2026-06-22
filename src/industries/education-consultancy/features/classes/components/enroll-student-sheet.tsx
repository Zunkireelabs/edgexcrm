"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Loader2, Search } from "lucide-react";
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

interface LeadOption {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

interface ClassOption {
  id: string;
  name: string;
  default_fee: number | null;
}

interface EnrollStudentSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classes: ClassOption[];
  defaultClassId?: string;
  onSuccess: () => void;
}

export function EnrollStudentSheet({
  open,
  onOpenChange,
  classes,
  defaultClassId,
  onSuccess,
}: EnrollStudentSheetProps) {
  const [submitting, setSubmitting] = useState(false);
  const [leadSearch, setLeadSearch] = useState("");
  const [leadOptions, setLeadOptions] = useState<LeadOption[]>([]);
  const [leadSearching, setLeadSearching] = useState(false);
  const [selectedLead, setSelectedLead] = useState<LeadOption | null>(null);
  const [classId, setClassId] = useState(defaultClassId ?? classes[0]?.id ?? "");
  const [feePaid, setFeePaid] = useState(false);
  const [feeAmount, setFeeAmount] = useState("");
  const [notes, setNotes] = useState("");

  // When classId changes, pre-fill from default_fee
  const selectedClass = classes.find((c) => c.id === classId);

  useEffect(() => {
    if (!open) {
      setLeadSearch("");
      setLeadOptions([]);
      setSelectedLead(null);
      setFeePaid(false);
      setFeeAmount("");
      setNotes("");
    }
    if (open) {
      setClassId(defaultClassId ?? classes[0]?.id ?? "");
    }
  }, [open, defaultClassId, classes]);

  // When fee paid is toggled on, pre-fill amount from class default_fee
  useEffect(() => {
    if (feePaid && feeAmount === "" && selectedClass?.default_fee != null) {
      setFeeAmount(String(selectedClass.default_fee));
    }
    if (!feePaid) setFeeAmount("");
  }, [feePaid, selectedClass, feeAmount]);

  // Debounced lead search
  useEffect(() => {
    if (!open || leadSearch.length < 2) { setLeadOptions([]); return; }
    const timer = setTimeout(async () => {
      setLeadSearching(true);
      try {
        const res = await fetch(`/api/v1/leads?search=${encodeURIComponent(leadSearch)}&pageSize=10`);
        if (!res.ok) return;
        const { data } = await res.json();
        setLeadOptions(data ?? []);
      } catch {
        // ignore
      } finally {
        setLeadSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [open, leadSearch]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedLead) { toast.error("Select a student first"); return; }
    if (!classId) { toast.error("Select a class"); return; }

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        lead_id: selectedLead.id,
        class_id: classId,
        fee_paid: feePaid,
      };
      if (feePaid && feeAmount.trim()) body.fee_amount = Number(feeAmount);
      if (notes.trim()) body.notes = notes.trim();

      const res = await fetch("/api/v1/class-enrollments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error?.message ?? "Failed to enroll student");
      }

      toast.success("Student enrolled");
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to enroll student");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Enroll Student</SheetTitle>
          <SheetDescription>
            Add a student to a class. Student will be auto-moved to Qualified if they are Pre-qualified.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          {/* Student search */}
          <div className="space-y-1.5">
            <Label className="text-xs text-gray-600">
              Student <span className="text-destructive">*</span>
            </Label>
            {selectedLead ? (
              <div className="flex items-center gap-2 p-2 border rounded-md bg-muted/30">
                <span className="flex-1 text-sm">
                  {[selectedLead.first_name, selectedLead.last_name].filter(Boolean).join(" ")}
                  {selectedLead.email && (
                    <span className="text-muted-foreground ml-1 text-xs">({selectedLead.email})</span>
                  )}
                </span>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => { setSelectedLead(null); setLeadSearch(""); }}
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={leadSearch}
                  onChange={(e) => setLeadSearch(e.target.value)}
                  placeholder="Search by name or email..."
                  className="pl-8"
                />
                {leadSearch.length >= 2 && (
                  <div className="absolute z-10 w-full mt-1 bg-card border rounded-md shadow-lg max-h-48 overflow-y-auto">
                    {leadSearching && (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    )}
                    {!leadSearching && leadOptions.length === 0 && (
                      <div className="px-3 py-2 text-sm text-muted-foreground">No students found</div>
                    )}
                    {!leadSearching && leadOptions.map((lead) => (
                      <button
                        key={lead.id}
                        type="button"
                        onClick={() => { setSelectedLead(lead); setLeadSearch(""); setLeadOptions([]); }}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors"
                      >
                        {[lead.first_name, lead.last_name].filter(Boolean).join(" ")}
                        {lead.email && (
                          <span className="text-muted-foreground ml-1 text-xs">({lead.email})</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Class selection */}
          <div className="space-y-1.5">
            <Label className="text-xs text-gray-600">Class <span className="text-destructive">*</span></Label>
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

          {/* Fee */}
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
            disabled={submitting || !selectedLead || !classId}
          >
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Enroll Student
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

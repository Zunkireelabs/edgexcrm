"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ACADEMIC_LEVELS,
  TEST_TYPES,
  ALL_ACADEMIC_TEST_COLUMNS,
  hasProspectQualification,
} from "@/lib/leads/prospect-qualification";

interface ProspectQualificationDialogProps {
  lead: Record<string, unknown> | null;
  open: boolean;
  onConfirm: (patch: Record<string, string>) => void | Promise<void>;
  onCancel: () => void;
}

// Shared block-and-fill-in modal for any surface that moves a lead into the Prospects
// list without a qualifying %/GPA already on file (funnel kanban drag, list stepper).
export function ProspectQualificationDialog({ lead, open, onConfirm, onCancel }: ProspectQualificationDialogProps) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open && lead) {
      const seeded: Record<string, string> = {};
      for (const col of ALL_ACADEMIC_TEST_COLUMNS) {
        seeded[col] = String(lead[col] ?? "");
      }
      setFields(seeded);
    }
  }, [open, lead]);

  const update = (col: string, value: string) => setFields((prev) => ({ ...prev, [col]: value }));

  const valid = hasProspectQualification(fields);

  async function handleConfirm() {
    setSubmitting(true);
    try {
      await onConfirm(fields);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !submitting) onCancel(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add academic qualification</DialogTitle>
          <DialogDescription>
            Enter the student&apos;s highest qualification (%/GPA) before moving to Prospects.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          <div className="rounded-md border bg-muted/30 p-3 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Academic Qualification
            </p>
            {ACADEMIC_LEVELS.map((level) => (
              <div key={level.key} className="space-y-1">
                <Label className="text-xs">{level.label}</Label>
                <div className="grid grid-cols-3 gap-2">
                  <Input
                    placeholder="%/GPA"
                    value={fields[`${level.key}_gpa`] || ""}
                    onChange={(e) => update(`${level.key}_gpa`, e.target.value)}
                    disabled={submitting}
                    className="h-8 text-xs"
                  />
                  <Input
                    placeholder="School / College"
                    value={fields[`${level.key}_institution`] || ""}
                    onChange={(e) => update(`${level.key}_institution`, e.target.value)}
                    disabled={submitting}
                    className="h-8 text-xs"
                  />
                  <Input
                    placeholder="Passed year"
                    inputMode="numeric"
                    value={fields[`${level.key}_passed_year`] || ""}
                    onChange={(e) => update(`${level.key}_passed_year`, e.target.value)}
                    disabled={submitting}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-md border bg-muted/30 p-3 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Test Report &amp; Score
            </p>
            <div className="grid grid-cols-2 gap-3">
              {TEST_TYPES.map((t) => (
                <div key={t.key} className="space-y-1">
                  <Label className="text-xs">{t.label}</Label>
                  <Input
                    placeholder="Score"
                    value={fields[`${t.key}_score`] || ""}
                    onChange={(e) => update(`${t.key}_score`, e.target.value)}
                    disabled={submitting}
                    className="h-8 text-xs"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!valid || submitting}>
            {submitting ? "Saving…" : "Confirm & move to Prospects"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
